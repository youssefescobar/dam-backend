import { z } from 'zod';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ADMIN_TYPES, presignPrivateRead, presignUpload } from '../services/storage.js';

const MB = 1024 * 1024;
/** The admin shrinks photos before upload, so 10 MB only matters for GIFs or pasted originals. */
const MAX_BYTES = { image: 10 * MB, video: 100 * MB, application: 20 * MB };

const uploadSchema = z
  .object({
    contentType: z.enum(ADMIN_TYPES, { message: 'file type not allowed' }),
    size: z.number().int().positive(),
  })
  .refine((b) => b.size <= MAX_BYTES[b.contentType.split('/')[0]], {
    path: ['size'],
    message: 'file too large (images 10 MB, videos 100 MB, documents 20 MB)',
  });

const router = Router();

/**
 * Admin: presign a public upload for site content (images, video, PDFs).
 * The browser PUTs the file to uploadUrl with `headers`, then saves `url` on the content item.
 */
router.post('/', requireAuth, validateBody(uploadSchema), async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    res.json(await presignUpload({ bucket: 'public', prefix: `admin/${month}`, ...req.body }));
  } catch (err) {
    next(err);
  }
});

/** Admin: short-lived download link for a customer's private file (e.g. chat/<conversationId>/<uuid>.pdf). */
router.get('/private', requireAuth, async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!/^chat\/[a-f0-9]{24}\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(key)) throw new HttpError(400, 'Invalid file key');
    res.json({ url: await presignPrivateRead(key) });
  } catch (err) {
    next(err);
  }
});

export default router;
