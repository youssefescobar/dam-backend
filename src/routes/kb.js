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
});

const importSchema = z
  .object({
    entries: z
      .array(
        z.object({
          title: z.string().min(1),
          content: z.string().min(1),
        })
      )
      .optional(),
    csv: z.string().optional(),
    mode: z.enum(['append', 'upsert']).optional(),
    replaceAll: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.csv?.trim()) || (b.entries && b.entries.length > 0), {
    message: 'Provide csv text or a non-empty entries array',
  });

const router = Router();

router.use(requireAuth);

router.post('/', validateBody(kbSchema), async (req, res, next) => {
  try {
    const entry = await KnowledgeBaseEntry.create({
      title: req.body.title,
      content: req.body.content,
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post('/import', validateBody(importSchema), async (req, res, next) => {
  try {
    const entries = req.body.csv?.trim()
      ? parseKbCsv(req.body.csv)
      : req.body.entries || [];

    if (!entries.length) {
      throw new HttpError(400, 'No valid title/content rows to import');
    }

    const summary = await importKnowledgeEntries(entries, {
      mode: req.body.mode || 'upsert',
      replaceAll: Boolean(req.body.replaceAll),
    });

    res.status(201).json({
      ok: true,
      count: entries.length,
      ...summary,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validateBody(kbSchema), async (req, res, next) => {
  try {
    const entry = await KnowledgeBaseEntry.findById(req.params.id);
    if (!entry) {
      throw new HttpError(404, 'Knowledge base entry not found');
    }
    entry.title = req.body.title;
    entry.content = req.body.content;
    await entry.save();
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const entry = await KnowledgeBaseEntry.findByIdAndDelete(req.params.id);
    if (!entry) {
      throw new HttpError(404, 'Knowledge base entry not found');
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const entry = await KnowledgeBaseEntry.findById(req.params.id).lean();
    if (!entry) {
      throw new HttpError(404, 'Knowledge base entry not found');
    }
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const entries = await KnowledgeBaseEntry.find().sort({ updatedAt: -1 }).lean();
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

export default router;
