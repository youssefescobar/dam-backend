import { z } from 'zod';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ADMIN_TYPES, presignPrivateRead, presignUpload } from '../services/storage.js';

const MAX_ADMIN_BYTES = 200 * 1024 * 1024;

const uploadSchema = z.object({
  contentType: z.enum(ADMIN_TYPES, { message: 'file type not allowed' }),
  size: z.number().int().positive().max(MAX_ADMIN_BYTES, 'file is larger than 200 MB'),
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
