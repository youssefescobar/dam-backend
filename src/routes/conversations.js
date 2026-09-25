import { Router } from 'express';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Customer, customerPublic } from '../models/Customer.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { emitToAdminQueue, emitToConversation } from '../sockets/chat.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /conversations?status=&mine=1
 * mine=1 with status=claimed (or alone) → assigned to current admin
 */
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    const mine =
      req.query.mine === '1' ||
      req.query.mine === 'true' ||
      req.query.assigned === 'me';
    if (mine) {
      filter.assignedAdminId = req.admin._id;
      if (!filter.status) filter.status = 'claimed';
    }

    let sort = { updatedAt: -1 };
    if (filter.status === 'needs_human') {
      // Oldest waiting first
      sort = { lastActivityAt: 1, updatedAt: 1 };
    } else if (filter.status === 'claimed' || mine) {
      sort = { lastCustomerMessageAt: -1, lastActivityAt: -1 };
    }

    const conversations = await Conversation.find(filter)
      .sort(sort)
      .limit(100)
      .lean();

    const customerIds = [...new Set(conversations.map((c) => String(c.customerId)))];
    const customers = await Customer.find({ _id: { $in: customerIds } }).lean();
    const byId = Object.fromEntries(customers.map((c) => [String(c._id), c]));

    res.json({
      conversations: conversations.map((c) => ({
        ...c,
        hasUnreadCustomerReply: Boolean(
          c.lastCustomerMessageAt &&
            (!c.lastAdminMessageAt ||
              new Date(c.lastCustomerMessageAt) > new Date(c.lastAdminMessageAt))
        ),
        customer: customerPublic(byId[String(c.customerId)]),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    status: z.enum(['closed', 'needs_human', 'ai_handling', 'claimed']).optional(),
  })
  .refine((b) => Boolean(b.status), { message: 'status is required' });

/**
 * PATCH /conversations/:id - close or update status
 */
router.patch('/:id', validateBody(patchSchema), async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    if (req.body.status) {
      conversation.status = req.body.status;
      if (req.body.status === 'needs_human') {
        conversation.assignedAdminId = null;
      }
      conversation.lastActivityAt = new Date();
    }

    await conversation.save();

    if (req.body.status === 'closed') {
      const notice = await Message.create({
        conversationId: conversation._id,
        sender: 'system',
        text: 'This conversation was closed by an admin.',
      });
      emitToConversation(conversation._id.toString(), 'message:new', {
        sender: 'system',
        text: notice.text,
        conversationId: conversation._id.toString(),
      });
      emitToAdminQueue('conversation:closed', {
        conversationId: conversation._id.toString(),
      });
    }

    res.json({ conversation });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /conversations/:id - permanently remove chat + messages
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    const conversationId = conversation._id.toString();
    await Message.deleteMany({ conversationId: conversation._id });
    await conversation.deleteOne();

    emitToAdminQueue('conversation:deleted', { conversationId });
    emitToConversation(conversationId, 'conversation:deleted', { conversationId });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /conversations/:id/messages
 */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id).lean();
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .lean();

    const customer = await Customer.findById(conversation.customerId).lean();

    res.json({
      conversation: {
        ...conversation,
        customer: customerPublic(customer),
      },
      messages,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
