import { z } from 'zod';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../middleware/validate.js';
import { handleChatMessage, startChatSession } from '../services/chat.js';
import { getWelcomePayload, MAIN_MENU_OPTIONS } from '../config/guidedChat.js';

const sessionSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email('valid email is required'),
  phone: z.string().min(5, 'phone is required'),
});

const messageSchema = z
  .object({
    text: z.string().optional(),
    choiceId: z.string().min(1).optional(),
    conversationId: z.string().optional(),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    /** @deprecated use session + conversationId */
    customerContact: z.string().optional(),
  })
  .refine((b) => Boolean(b.choiceId) || Boolean(String(b.text || '').trim()), {
    message: 'text or choiceId is required',
  });

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

/** Initial guided menu (no conversation yet). */
router.get('/guided', (_req, res) => {
  const welcome = getWelcomePayload();
  res.json({
    answer: welcome.answer,
    options: welcome.options,
    reason: welcome.reason,
  });
});

router.get('/options', (_req, res) => {
  res.json({ options: MAIN_MENU_OPTIONS });
});

/** Collect identity and open a conversation. */
router.post('/session', chatLimiter, validateBody(sessionSchema), async (req, res, next) => {
  try {
    const { customer, conversation } = await startChatSession(req.body);
    res.status(201).json({
      conversationId: conversation._id,
      status: conversation.status,
      customer,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/message', chatLimiter, validateBody(messageSchema), async (req, res, next) => {
  try {
    const result = await handleChatMessage(req.body);
    res.status(200).json({
      conversationId: result.conversation._id,
      status: result.conversation.status,
      escalated: result.escalated,
      answer: result.answer,
      reason: result.reason || null,
      systemMessage: result.systemMessage || null,
      options: result.options || [],
      detail: result.detail || null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
