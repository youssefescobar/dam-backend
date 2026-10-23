import { z } from 'zod';
import { Router } from 'express';
import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseKbCsv } from '../utils/csv.js';
import { importKnowledgeEntries } from '../services/kbImport.js';

const kbSchema = z.object({
  title: z.string().min(1, 'title is required'),
  content: z.string().min(1, 'content is required'),
  sourceId: z.string().optional().nullable(),
  intent: z.string().optional().default(''),
  category: z.string().optional().default(''),
  locale: z.enum(['en', 'ar']).optional().default('en'),
  escalate: z.boolean().optional().default(false),
  requiresLiveData: z.boolean().optional().default(false),
});

const entryImportSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  sourceId: z.string().optional(),
  intent: z.string().optional(),
  category: z.string().optional(),
  locale: z.enum(['en', 'ar']).optional(),
  escalate: z.boolean().optional(),
  requiresLiveData: z.boolean().optional(),
});

const importSchema = z
  .object({
    entries: z.array(entryImportSchema).optional(),
    csv: z.string().optional(),
    mode: z.enum(['append', 'upsert']).optional(),
  })
  .refine((b) => Boolean(b.csv?.trim()) || (b.entries && b.entries.length > 0), {
    message: 'Provide csv text or a non-empty entries array',
  });

const router = Router();

router.use(requireAuth);

router.post('/', validateBody(kbSchema), async (req, res) => {
  const entry = await KnowledgeBaseEntry.create({
    title: req.body.title,
    content: req.body.content,
    sourceId: req.body.sourceId || null,
    intent: req.body.intent || '',
    category: req.body.category || '',
    locale: req.body.locale || 'en',
    escalate: Boolean(req.body.escalate),
    requiresLiveData: Boolean(req.body.requiresLiveData),
  });
  res.status(201).json({ entry });
});

router.post('/import', validateBody(importSchema), async (req, res) => {
  const entries = req.body.csv?.trim()
    ? parseKbCsv(req.body.csv)
    : req.body.entries || [];

  if (!entries.length) {
    throw new HttpError(400, 'No valid title/content rows to import');
  }

  // No "replace all" over HTTP: it wiped both languages and left the bot empty mid-import.
  // The seed script (KB_REPLACE_ALL=1) still can, for a fresh setup.
  const summary = await importKnowledgeEntries(entries, { mode: req.body.mode || 'upsert' });

  res.status(201).json({
    ok: true,
    count: entries.length,
    ...summary,
  });
});

router.put('/:id', validateBody(kbSchema), async (req, res) => {
  const entry = await KnowledgeBaseEntry.findById(req.params.id);
  if (!entry) {
    throw new HttpError(404, 'Knowledge base entry not found');
  }
  entry.title = req.body.title;
  entry.content = req.body.content;
  if (req.body.sourceId !== undefined) entry.sourceId = req.body.sourceId || null;
  if (req.body.intent !== undefined) entry.intent = req.body.intent || '';
  if (req.body.category !== undefined) entry.category = req.body.category || '';
  if (req.body.locale !== undefined) entry.locale = req.body.locale;
  if (req.body.escalate !== undefined) entry.escalate = Boolean(req.body.escalate);
  if (req.body.requiresLiveData !== undefined) {
    entry.requiresLiveData = Boolean(req.body.requiresLiveData);
  }
  await entry.save();
  res.json({ entry });
});

router.delete('/:id', async (req, res) => {
  const entry = await KnowledgeBaseEntry.findByIdAndDelete(req.params.id);
  if (!entry) {
    throw new HttpError(404, 'Knowledge base entry not found');
  }
  res.status(204).send();
});

router.get('/:id', async (req, res) => {
  const entry = await KnowledgeBaseEntry.findById(req.params.id).lean();
  if (!entry) {
    throw new HttpError(404, 'Knowledge base entry not found');
  }
  res.json({ entry });
});

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.locale === 'ar' || req.query.locale === 'en') {
    filter.locale = req.query.locale;
  }
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.intent) filter.intent = String(req.query.intent);
  if (req.query.escalate === 'true') filter.escalate = true;
  if (req.query.escalate === 'false') filter.escalate = false;

  const entries = await KnowledgeBaseEntry.find(filter)
    .sort({ sourceId: 1, updatedAt: -1 })
    .lean();
  res.json({ entries });
});

export default router;
