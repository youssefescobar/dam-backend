import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { Router } from 'express';
import { FleetBus, QUOTE_CLASSES } from '../models/FleetBus.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { deleteUnusedMedia } from '../services/mediaCleanup.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '../../data/fleet-seed.json');

/** A site path (`/fleet/x.webp`, not `//host`) or an https:// URL. */
const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .regex(/^(\/(?!\/)|https:\/\/)/, 'use a site path starting with / or an https:// URL');

const localizedSchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
  seatsLabel: z.string().trim().max(120).optional().default(''),
  summary: z.string().max(2000).optional().default(''),
  amenities: z.array(z.string().trim().min(1).max(120)).max(40).optional().default([]),
});

const busSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and dashes')
    .max(80),
  /** Left out: a new bus goes last, an edited bus keeps its place. */
  sortOrder: z.coerce.number().int().optional(),
  published: z.boolean().optional().default(true),
  showInShowroom: z.boolean().optional().default(true),
  quoteClass: z.enum(QUOTE_CLASSES).optional().default('vip'),
  coverImage: imageUrl.or(z.literal('')).optional().default(''),
  exteriorImages: z.array(imageUrl).max(20).optional().default([]),
  interiorImages: z.array(imageUrl).max(20).optional().default([]),
  ar: localizedSchema.optional().default({}),
  en: localizedSchema.optional().default({}),
  fr: localizedSchema.optional().default({}),
  id: localizedSchema.optional().default({}),
});

const orderSchema = z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/, 'invalid id')).max(500) });

function checkBus(body) {
  if (!body.en.name && !body.ar.name) {
    throw new HttpError(400, 'Validation failed', { 'en.name': 'name is required in English or Arabic' });
  }
}

const dupSlug = (err) =>
  err?.code === 11000 ? new HttpError(409, 'Another bus already uses this slug', { slug: 'already in use' }) : err;

/** First admin visit: start from the buses the website shows today. */
async function seedIfEmpty() {
  if (await FleetBus.estimatedDocumentCount()) return;
  const seed = JSON.parse(await fs.promises.readFile(SEED_PATH, 'utf8'));
  // A parallel request may seed at the same time; its duplicates are skipped.
  await FleetBus.insertMany(seed, { ordered: false }).catch((err) => {
    if (err?.code !== 11000) throw err;
  });
}

/** Delete files a save or delete left unused. Runs after the response; a storage hiccup is only logged (the hourly sweep retries). */
const cleanUp = (urls) =>
  deleteUnusedMedia(urls).catch((err) => logger.warn({ err: err.message }, 'media cleanup failed'));

const imagesOf = (doc) => [doc.coverImage, ...(doc.exteriorImages || []), ...(doc.interiorImages || [])];

const FALLBACK = { ar: ['ar', 'en'], en: ['en', 'ar'], fr: ['fr', 'en', 'ar'], id: ['id', 'en', 'ar'] };

/** Pick the requested language, falling back field by field. */
function localize(doc, locale) {
  const langs = FALLBACK[locale].map((l) => doc[l] || {});
  const t = (field) => langs.map((l) => l[field]?.trim()).find(Boolean) || '';
  return {
    id: doc.slug,
    name: t('name'),
    seatsLabel: t('seatsLabel'),
    summary: t('summary'),
    amenities: langs.map((l) => l.amenities).find((a) => a?.length) || [],
    coverImage: doc.coverImage || doc.exteriorImages?.[0] || '',
    exteriorImages: doc.exteriorImages || [],
    interiorImages: doc.interiorImages || [],
    showInShowroom: doc.showInShowroom,
    quoteClass: doc.quoteClass,
  };
}

const SORT = { sortOrder: 1, createdAt: 1 };

const router = Router();

/** Public: published buses in website shape, e.g. GET /fleet?locale=fr */
router.get('/', async (req, res) => {
  const locale = FALLBACK[req.query.locale] ? req.query.locale : 'ar';
  const docs = await FleetBus.find({ published: true }).sort(SORT).limit(200).lean();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ items: docs.map((d) => localize(d, locale)) });
});

/** Admin: every bus, hidden ones included, all languages. */
router.get('/all', requireAuth, async (_req, res) => {
  await seedIfEmpty();
  res.json({ items: await FleetBus.find().sort(SORT).lean() });
});

router.post('/', requireAuth, validateBody(busSchema), async (req, res, next) => {
  try {
    checkBus(req.body);
    await seedIfEmpty();
    const last = await FleetBus.findOne({}, 'sortOrder').sort({ sortOrder: -1 }).lean();
    const item = await FleetBus.create({ ...req.body, sortOrder: req.body.sortOrder ?? (last?.sortOrder ?? -1) + 1 });
    res.status(201).json({ item });
  } catch (err) {
    next(dupSlug(err));
  }
});

router.put('/order', requireAuth, validateBody(orderSchema), async (req, res) => {
  if (req.body.ids.length) {
    await FleetBus.bulkWrite(
      req.body.ids.map((_id, sortOrder) => ({ updateOne: { filter: { _id }, update: { $set: { sortOrder } } } }))
    );
  }
  res.json({ ok: true });
});

router.put('/:id', requireAuth, validateBody(busSchema), async (req, res, next) => {
  try {
    checkBus(req.body);
    const item = await FleetBus.findById(req.params.id);
    if (!item) throw new HttpError(404, 'Not found');
    const before = imagesOf(item);
    const { sortOrder, ...fields } = req.body;
    item.set(sortOrder === undefined ? fields : req.body);
    await item.save();
    res.json({ item });
    const kept = new Set(imagesOf(item));
    cleanUp(before.filter((url) => !kept.has(url)));
  } catch (err) {
    next(dupSlug(err));
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const deleted = await FleetBus.findByIdAndDelete(req.params.id);
  if (!deleted) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
  cleanUp(imagesOf(deleted));
});

export default router;
