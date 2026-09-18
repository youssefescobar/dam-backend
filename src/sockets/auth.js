import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin.js';

/**
 * Socket.io middleware: optional JWT on handshake.
 * Public customer events work without auth; admin events check socket.data.admin.
 */
export function socketAuthMiddleware(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    (typeof socket.handshake.headers?.authorization === 'string'
      ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
      : null);

  if (!token) {
    socket.data.admin = null;
    return next();
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return next(new Error('JWT_SECRET is not configured'));
  }

  jwt.verify(token, secret, async (err, payload) => {
    if (err || !payload?.sub) {
      return next(new Error('Invalid or expired token'));
    }
    try {
      const admin = await Admin.findById(payload.sub).select('-passwordHash');
      if (!admin) {
        return next(new Error('Invalid or expired token'));
      }
      socket.data.admin = admin;
      next();
    } catch (e) {
      next(e);
    }
  });
}

export function requireSocketAdmin(socket) {
  if (!socket.data?.admin) {
    throw new Error('Admin authentication required');
  }
  return socket.data.admin;
}
