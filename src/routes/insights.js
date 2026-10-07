import { z } from 'zod';
import { Router } from 'express';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { UnansweredQuestion } from '../models/UnansweredQuestion.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';

const MISS_REASONS = ['model_uncertain', 'empty_kb', 'llm_failure'];
const HANDOVER_REASONS = [
  'explicit_human_request',
  'safety_critical',
  'model_escalate',
  'model_uncertain',
  'faq_load_failed',
];
const ANSWERED_REASONS = ['faq', 'guided', 'guided_free_text'];

const patchSchema = z.object({ status: z.enum(['open', 'resolved', 'dismissed']) });

const router = Router();
router.use(requireAuth);

router.get('/unanswered', async (req, res, next) => {
  try {
    const filter = { status: String(req.query.status || 'open') };
    const items = await UnansweredQuestion.find(filter).sort({ lastAskedAt: -1 }).limit(500).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.patch('/unanswered/:id', validateBody(patchSchema), async (req, res, next) => {
  try {
    const item = await UnansweredQuestion.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { returnDocument: 'after' }
    );
    if (!item) throw new HttpError(404, 'Not found');
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

const countBy = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));

/** Date range via ?from=&to= (ISO dates); defaults to the last 30 days. */
router.get('/analytics', async (req, res, next) => {
  try {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 864e5);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, 'Invalid date range');
    const range = { $gte: from, $lte: to };

    const group = (match, by) =>
      Message.aggregate([
        { $match: { createdAt: range, ...match } },
        { $group: { _id: by, n: { $sum: 1 } } },
      ]);
    const [handovers, topics, turns, conversations, escalatedConversations] = await Promise.all([
      group({ sender: 'system', reason: { $in: HANDOVER_REASONS } }, '$reason'),
      group({ sender: 'ai', topic: { $ne: '' } }, '$topic'),
      group({ sender: { $in: ['ai', 'system'] }, reason: { $in: [...MISS_REASONS, ...ANSWERED_REASONS] } }, '$reason'),
      Conversation.countDocuments({ createdAt: range }),
      Message.distinct('conversationId', { createdAt: range, sender: 'system', reason: { $in: HANDOVER_REASONS } }),
    ]);

    const turnCounts = countBy(turns);
    const misses = MISS_REASONS.reduce((n, r) => n + (turnCounts[r] || 0), 0);
    const answered = ANSWERED_REASONS.reduce((n, r) => n + (turnCounts[r] || 0), 0);
    const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : 0);

    res.json({
      from,
      to,
      conversations,
      handovers: countBy(handovers),
      topics: countBy(topics),
      handoverRate: ratio(escalatedConversations.length, conversations),
      missRate: ratio(misses, misses + answered),
      misses,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
