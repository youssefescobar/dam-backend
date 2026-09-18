import { Router } from 'express';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Customer } from '../models/Customer.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { emitToAdminQueue, emitToConversation } from '../sockets/chat.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /conversations?status=needs_human|claimed|ai_handling|closed
 */
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    const conversations = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    const customerIds = [...new Set(conversations.map((c) => String(c.customerId)))];
    const customers = await Customer.find({ _id: { $in: customerIds } }).lean();
    const byId = Object.fromEntries(customers.map((c) => [String(c._id), c]));

    res.json({
      conversations: conversations.map((c) => ({
        ...c,
        customer: byId[String(c.customerId)]
          ? {
              id: byId[String(c.customerId)]._id,
              name: byId[String(c.customerId)].name,
              contact: byId[String(c.customerId)].contact,
            }
          : null,
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
 * PATCH /conversations/:id — close or update status
 */
router.patch('/:id', validateBody(patchSchema), async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    if (req.body.status) {
      conversation.status = req.body.status;
      if (req.body.status === 'closed') {
        // keep assignedAdminId for history
      }
      if (req.body.status === 'needs_human') {
        conversation.assignedAdminId = null;
      }
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
        customer: customer
          ? { id: customer._id, name: customer.name, contact: customer.contact }
          : null,
      },
      messages,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
