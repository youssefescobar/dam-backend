import { z } from 'zod';
import { Router } from 'express';
import { CONTENT_KINDS, SiteContent } from '../models/SiteContent.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';

const localizedSchema = z
  .object({
    title: z.string().max(200),
    excerpt: z.string().max(600),
    body: z.string().max(20000),
    quote: z.string().max(1200),
    name: z.string().max(120),
    role: z.string().max(160),
  })
  .partial();

const itemSchema = z.object({
  published: z.boolean().optional().default(false),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and dashes')
    .max(120)
    .optional()
    .or(z.literal('')),
  image: z.string().trim().max(1000).optional().default(''),
  /** News only: images/videos in display order; the first one is the cover. */
  media: z.array(z.string().trim().min(1).max(1000)).max(12).optional(),
  publishedAt: z.coerce.date().optional().nullable(),
  sortOrder: z.coerce.number().int().optional().default(0),
  en: localizedSchema.optional().default({}),
  ar: localizedSchema.optional().default({}),
});

const kindOf = (req) => {
  const kind = String(req.params.kind || '');
  if (!CONTENT_KINDS.includes(kind)) throw new HttpError(404, 'Unknown content type');
  return kind;
};

/** Required fields per kind, checked in at least one language. */
const REQUIRED = {
  news: ['title', 'body'],
  testimonial: ['quote', 'name'],
};

function checkItem(kind, body) {
  const has = (field) => Boolean(body.en?.[field]?.trim() || body.ar?.[field]?.trim());
  const missing = REQUIRED[kind].filter((f) => !has(f));
  if (missing.length) {
    throw new HttpError(
      400,
      'Validation failed',
      Object.fromEntries(missing.map((f) => [`en.${f}`, `${f} is required in English or Arabic`]))
    );
  }
  if (kind === 'news' && !body.slug) {
    throw new HttpError(400, 'Validation failed', { slug: 'slug is required for news' });
  }
}

/** News keeps `image` as its cover (the first media item) so older readers still work. */
function withCover(kind, body) {
  if (kind !== 'news') return { ...body, media: [] };
  const media = body.media ?? (body.image ? [body.image] : []);
  return { ...body, media, image: media[0] || '' };
}

const mediaOf = (doc) => (doc.media?.length ? doc.media : doc.image ? [doc.image] : []);

/** Pick the requested language, falling back to the other one field by field. */
function localize(doc, locale) {
  const main = doc[locale] || {};
  const other = doc[locale === 'ar' ? 'en' : 'ar'] || {};
  const t = (field) => main[field]?.trim() || other[field]?.trim() || '';
  const id = String(doc._id);
  if (doc.kind === 'news') {
    return {
      slug: doc.slug,
      title: t('title'),
      excerpt: t('excerpt'),
      body: t('body'),
      publishedAt: (doc.publishedAt || doc.createdAt)?.toISOString?.() ?? null,
      coverImage: mediaOf(doc)[0] || null,
      media: mediaOf(doc),
    };
  }
  return { id, quote: t('quote'), name: t('name'), role: t('role'), avatar: doc.image || null };
}

const SORT = {
  news: { publishedAt: -1, createdAt: -1 },
  testimonial: { sortOrder: 1, createdAt: -1 },
};

const router = Router();

/** Public: published items in website shape, e.g. GET /content/news?locale=ar */
router.get('/:kind', async (req, res, next) => {
  try {
    const kind = kindOf(req);
    const locale = req.query.locale === 'en' ? 'en' : 'ar';
    const docs = await SiteContent.find({ kind, published: true }).sort(SORT[kind]).limit(200).lean();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: docs.map((d) => localize(d, locale)) });
  } catch (err) {
    next(err);
  }
});

/** Admin: every item of a kind, drafts included, both languages. */
router.get('/:kind/all', requireAuth, async (req, res, next) => {
  try {
    const kind = kindOf(req);
    const items = await SiteContent.find({ kind }).sort(SORT[kind]).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/:kind', requireAuth, validateBody(itemSchema), async (req, res, next) => {
  try {
    const kind = kindOf(req);
    checkItem(kind, req.body);
    const item = await SiteContent.create({
      ...withCover(kind, req.body),
      kind,
      publishedAt: req.body.publishedAt ?? (req.body.published ? new Date() : null),
    });
    res.status(201).json({ item });
  } catch (err) {
    if (err?.code === 11000) return next(new HttpError(409, 'Another news post already uses this slug', { slug: 'already in use' }));
    next(err);
  }
});

router.put('/:kind/:id', requireAuth, validateBody(itemSchema), async (req, res, next) => {
  try {
    const kind = kindOf(req);
    checkItem(kind, req.body);
    const item = await SiteContent.findOne({ _id: req.params.id, kind });
    if (!item) throw new HttpError(404, 'Not found');
    const firstPublish = req.body.published && !item.published && !item.publishedAt;
    item.set({ ...withCover(kind, req.body), publishedAt: req.body.publishedAt ?? (firstPublish ? new Date() : item.publishedAt) });
    await item.save();
    res.json({ item });
  } catch (err) {
    if (err?.code === 11000) return next(new HttpError(409, 'Another news post already uses this slug', { slug: 'already in use' }));
    next(err);
  }
});

router.delete('/:kind/:id', requireAuth, async (req, res, next) => {
  try {
    const kind = kindOf(req);
    const deleted = await SiteContent.findOneAndDelete({ _id: req.params.id, kind });
    if (!deleted) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
