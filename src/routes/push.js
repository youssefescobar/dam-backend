import { z } from 'zod';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { Admin } from '../models/Admin.js';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

const router = Router();

router.post('/subscribe', requireAuth, validateBody(subscribeSchema), async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    const existingIdx = admin.pushSubscriptions.findIndex(
      (s) => s.endpoint === req.body.endpoint
    );
    if (existingIdx >= 0) {
      admin.pushSubscriptions[existingIdx] = req.body;
    } else {
      admin.pushSubscriptions.push(req.body);
    }
    await admin.save();
    res.status(201).json({
      ok: true,
      subscriptionCount: admin.pushSubscriptions.length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/unsubscribe', requireAuth, validateBody(unsubscribeSchema), async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    const before = admin.pushSubscriptions.length;
    admin.pushSubscriptions = admin.pushSubscriptions.filter(
      (s) => s.endpoint !== req.body.endpoint
    );
    await admin.save();
    res.json({
      ok: true,
      removed: before - admin.pushSubscriptions.length,
      subscriptionCount: admin.pushSubscriptions.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

export default router;