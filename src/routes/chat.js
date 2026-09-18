import { z } from 'zod';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../middleware/validate.js';
import { handleChatMessage } from '../services/chat.js';
import { getWelcomePayload, MAIN_MENU_OPTIONS } from '../config/guidedChat.js';

const messageSchema = z
  .object({
    text: z.string().optional(),
    choiceId: z.string().min(1).optional(),
    conversationId: z.string().optional(),
    customerName: z.string().optional(),
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
    });
  } catch (err) {
    next(err);
  }
});

export default router;
