import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Admin } from '../models/Admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
});

const router = Router();

const signToken = (admin) =>
  jwt.sign({ sub: admin._id.toString(), role: admin.role, email: admin.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email: email.toLowerCase() });
  if (!admin) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'Invalid email or password');
  }

  res.json({
    token: signToken(admin),
    admin: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  });
});

/**
 * Change your own password. Every other device is signed out (older tokens stop working);
 * this one gets a fresh token so it stays signed in.
 */
router.post('/password', loginLimiter, requireAuth, validateBody(passwordSchema), async (req, res) => {
  const admin = await Admin.findById(req.admin._id);
  const ok = await bcrypt.compare(req.body.currentPassword, admin.passwordHash);
  if (!ok) {
    throw new HttpError(400, 'Current password is wrong', { currentPassword: 'Current password is wrong' });
  }
  if (req.body.currentPassword === req.body.newPassword) {
    throw new HttpError(400, 'New password must be different', { newPassword: 'Same as the current one' });
  }

  admin.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
  // Floor to the second: the new token's `iat` must not be earlier than this.
  admin.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await admin.save();

  res.json({ token: signToken(admin) });
});

export default router;