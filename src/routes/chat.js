import { z } from 'zod';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { validateBody } from '../middleware/validate.js';
import { getConversationForResume, handleChatMessage, startChatSession } from '../services/chat.js';
import { REPLIES, getWelcomePayload, menuOptions, normalizeLang, pickText } from '../config/guidedChat.js';
import { getCompanySettings } from '../models/Settings.js';

const langSchema = z.enum(['en', 'ar']).optional();

const sessionSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().trim().min(5, 'phone is required').max(40),
  lang: langSchema,
});

const messageSchema = z
  .object({
    text: z.string().max(2000).optional(),
    choiceId: z.string().min(1).max(60).optional(),
    conversationId: z.string().optional(),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    lang: langSchema,
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

/** Per-customer cap on top of the per-IP one (shared Wi-Fi shouldn't throttle everyone, one chat shouldn't flood). */
const customerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => Number(process.env.CHAT_CUSTOMER_MAX_PER_MIN) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => {
    const b = req.body || {};
    const phone = String(b.customerPhone || '').replace(/\D/g, '');
    return b.conversationId ? `c:${b.conversationId}` : phone ? `p:${phone}` : ipKeyGenerator(req.ip);
  },
  handler: (req, res) => {
    const lang = normalizeLang(req.body?.lang);
    res.status(429).json({ error: pickText(REPLIES.rateLimited, lang), reason: 'rate_limited' });
  },
});

const langFrom = (req) => normalizeLang(req.query.lang);

/** Initial guided menu (no conversation yet). */
router.get('/guided', async (req, res, next) => {
  try {
    let settings = null;
    try {
      settings = await getCompanySettings();
    } catch {
      /* optional */
    }
    const welcome = getWelcomePayload(settings, langFrom(req));
    res.json({
      answer: welcome.answer,
      options: welcome.options,
      reason: welcome.reason,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/options', (req, res) => {
  res.json({ options: menuOptions(langFrom(req)) });
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

/** Restore an open chat after a page reload (requires the customer's phone). */
router.get('/history', chatLimiter, async (req, res, next) => {
  try {
    const result = await getConversationForResume(
      String(req.query.conversationId || ''),
      String(req.query.phone || ''),
    );
    if (!result) return res.status(404).json({ error: 'Conversation not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/message', chatLimiter, customerLimiter, validateBody(messageSchema), async (req, res, next) => {
  try {
    const result = await handleChatMessage(req.body);
    res.status(200).json({
      conversationId: result.conversation._id,
      status: result.conversation.status,
      escalated: result.escalated,
      answer: result.answer,
      messageId: result.messageId || null,
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
