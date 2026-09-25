import { Conversation, bumpConversationActivity } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { handleChatMessage } from '../services/chat.js';
import { logger } from '../utils/logger.js';
import { socketAuthMiddleware, requireSocketAdmin } from './auth.js';

/** @type {import('socket.io').Server | null} */
let io = null;

export function setIo(serverIo) {
  io = serverIo;
}

export function getIo() {
  return io;
}

export function emitToAdminQueue(event, payload) {
  if (io) {
    io.to('admin-queue').emit(event, payload);
  }
}

export function emitToConversation(conversationId, event, payload) {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, payload);
  }
}

/**
 * Attach Socket.io chat handlers.
 * @param {import('socket.io').Server} serverIo
 */
export function initChatSockets(serverIo) {
  setIo(serverIo);
  serverIo.use(socketAuthMiddleware);

  serverIo.on('connection', (socket) => {
    logger.info({ id: socket.id, admin: Boolean(socket.data.admin) }, 'socket connected');

    socket.on('join:conversation', async ({ conversationId } = {}) => {
      if (!conversationId) return;
      await socket.join(`conversation:${conversationId}`);
    });

    socket.on('join:admin-queue', async (_payload, ack) => {
      try {
        requireSocketAdmin(socket);
        await socket.join('admin-queue');
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('chat:message', async (payload = {}, ack) => {
      try {
        const result = await handleChatMessage({
          text: payload.text,
          conversationId: payload.conversationId,
          customerName: payload.customerName,
          customerEmail: payload.customerEmail,
          customerPhone: payload.customerPhone,
          customerContact: payload.customerContact,
          choiceId: payload.choiceId,
        });

        const response = {
          conversationId: result.conversation._id.toString(),
          status: result.conversation.status,
          escalated: result.escalated,
          answer: result.answer,
          reason: result.reason || null,
          systemMessage: result.systemMessage || null,
          options: result.options || [],
        };

        socket.join(`conversation:${response.conversationId}`);

        if (result.answer) {
          socket.emit('message:new', {
            sender: 'ai',
            text: result.answer,
            conversationId: response.conversationId,
          });
        }

        if (result.escalated) {
          socket.emit('conversation:escalated', {
            conversationId: response.conversationId,
            reason: result.reason,
          });
        }

        if (typeof ack === 'function') ack({ ok: true, ...response });
      } catch (err) {
        logger.error({ err: err.message }, 'chat:message failed');
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('admin:claim', async (payload = {}, ack) => {
      try {
        const admin = requireSocketAdmin(socket);
        const { conversationId } = payload;
        const adminId = admin._id.toString();
        if (!conversationId) {
          throw new Error('conversationId is required');
        }

        const claimed = await Conversation.findOneAndUpdate(
          {
            _id: conversationId,
            status: 'needs_human',
            assignedAdminId: null,
          },
          {
            $set: {
              status: 'claimed',
              assignedAdminId: adminId,
              lastActivityAt: new Date(),
            },
          },
          { returnDocument: 'after' }
        );

        if (!claimed) {
          const current = await Conversation.findById(conversationId);
          const result = {
            ok: false,
            error: 'Conversation already claimed or not available',
            conversation: current,
          };
          if (typeof ack === 'function') ack(result);
          return;
        }

        emitToAdminQueue('conversation:claimed', {
          conversationId: claimed._id.toString(),
          assignedAdminId: adminId,
        });
        emitToConversation(claimed._id.toString(), 'conversation:claimed', {
          conversationId: claimed._id.toString(),
          assignedAdminId: adminId,
        });

        if (typeof ack === 'function') {
          ack({ ok: true, conversation: claimed });
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('admin:message', async (payload = {}, ack) => {
      try {
        const admin = requireSocketAdmin(socket);
        const { conversationId, text } = payload;
        const adminId = admin._id.toString();
        if (!conversationId || !text) {
          throw new Error('conversationId and text are required');
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) throw new Error('Conversation not found');
        if (conversation.status === 'closed') {
          throw new Error('Conversation is closed');
        }

        const message = await Message.create({
          conversationId,
          sender: 'admin',
          text,
        });

        await bumpConversationActivity(conversation, 'admin');

        emitToConversation(conversationId, 'message:new', {
          sender: 'admin',
          text,
          messageId: message._id.toString(),
          adminId,
        });

        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      logger.info({ id: socket.id }, 'socket disconnected');
    });
  });
}
