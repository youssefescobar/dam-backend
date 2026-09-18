import jwt from 'jsonwebtoken';
import { HttpError } from './errorHandler.js';
import { Admin } from '../models/Admin.js';

/**
 * Require a valid admin JWT in Authorization: Bearer <token>
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'Authentication required');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new HttpError(500, 'JWT_SECRET is not configured');
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const admin = await Admin.findById(payload.sub).select('-passwordHash');
    if (!admin) {
      throw new HttpError(401, 'Invalid or expired token');
    }

    req.admin = admin;
    next();
  } catch (err) {
    next(err);
  }
}