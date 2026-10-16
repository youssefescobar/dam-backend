import { Conversation, bumpConversationActivity } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { customerOwnsConversation, handleChatMessage } from '../services/chat.js';
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

/** Agents currently connected to the admin queue, or null when sockets are not running. */
export async function countOnlineAdmins() {
  return io ? (await io.in('admin-queue').fetchSockets()).length : null;
}

const SOCKET_CHAT_WINDOW_MS = 60 * 1000;

/** Same per-minute cap as the HTTP per-customer limiter, counted per socket. */
function socketChatAllowed(socket) {
  const max = Number(process.env.CHAT_CUSTOMER_MAX_PER_MIN) || 20;
  const now = Date.now();
  const hits = (socket.data.chatHits || []).filter((t) => now - t < SOCKET_CHAT_WINDOW_MS);
  if (hits.length >= max) {
    socket.data.chatHits = hits;
    return false;
  }
  hits.push(now);
  socket.data.chatHits = hits;
  return true;
}

/** Admins may watch any conversation; customers must prove ownership with their phone. */
async function mayJoinConversation(socket, conversationId, phone) {
  if (socket.data.admin) return true;
  return customerOwnsConversation(conversationId, phone);
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

    socket.on('join:conversation', async ({ conversationId, phone } = {}, ack) => {
      if (!conversationId) return;
      const ok = await mayJoinConversation(socket, String(conversationId), phone).catch(() => false);
      if (ok) await socket.join(`conversation:${conversationId}`);
      if (typeof ack === 'function') ack({ ok });
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
        if (!socketChatAllowed(socket)) {
          throw new Error('Too many messages, please slow down');
        }
        // Join first so the room broadcasts from handleChatMessage reach this socket
        // (previously the reply was emitted twice: once to the room, once directly).
        if (payload.conversationId) {
          const owns = await mayJoinConversation(
            socket,
            String(payload.conversationId),
            payload.customerPhone
          );
          if (!owns) throw new Error('Conversation not found');
          await socket.join(`conversation:${payload.conversationId}`);
        }

        const result = await handleChatMessage({
          text: payload.text,
          conversationId: payload.conversationId,
          customerName: payload.customerName,
          customerEmail: payload.customerEmail,
          customerPhone: payload.customerPhone,
          customerContact: payload.customerContact,
          choiceId: payload.choiceId,
          lang: payload.lang,
        });

        const response = {
          conversationId: result.conversation._id.toString(),
          status: result.conversation.status,
          escalated: result.escalated,
          answer: result.answer,
          messageId: result.messageId || null,
          reason: result.reason || null,
          systemMessage: result.systemMessage || null,
          options: result.options || [],
        };

        // A brand-new conversation (no id in the payload) is only known now.
        await socket.join(`conversation:${response.conversationId}`);

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
        const { conversationId } = payload;
        const text = String(payload.text || '').trim().slice(0, 4000);
        const adminId = admin._id.toString();
        if (!conversationId || !text) {
          throw new Error('conversationId and text are required');
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) throw new Error('Conversation not found');
        // Only the agent who claimed the chat may talk in it (the AI is silent only while claimed).
        if (conversation.status !== 'claimed' || String(conversation.assignedAdminId) !== adminId) {
          throw new Error('Claim this chat first');
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
          conversationId,
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
