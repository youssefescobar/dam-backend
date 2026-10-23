import jwt from 'jsonwebtoken';
import { HttpError } from './errorHandler.js';
import { Admin } from '../models/Admin.js';

/**
 * The staff account a login token belongs to, or null if the token is bad, expired or
 * its account was deleted. Shared by HTTP (`requireAuth`) and sockets.
 * @param {string} token
 */
export async function adminFromToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, 'JWT_SECRET is not configured');
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    return null;
  }
  if (!payload?.sub) return null;
  const admin = await Admin.findById(payload.sub).select('-passwordHash');
  if (!admin) return null;
  // JWT `iat` is in whole seconds; a token from the same second as the change still counts.
  if (admin.passwordChangedAt && payload.iat < Math.floor(admin.passwordChangedAt.getTime() / 1000)) return null;
  return admin;
}

/**
 * Require a valid admin JWT in Authorization: Bearer <token>
 */
export async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentication required');
  const admin = await adminFromToken(token);
  if (!admin) throw new HttpError(401, 'Invalid or expired token');
  req.admin = admin;
  next();
}
