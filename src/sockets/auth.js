import { adminFromToken } from '../middleware/auth.js';

/**
 * Socket.io middleware: optional JWT on handshake.
 * Public customer events work without auth; admin events check socket.data.admin.
 */
export async function socketAuthMiddleware(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    (typeof socket.handshake.headers?.authorization === 'string'
      ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
      : null);

  socket.data.admin = null;
  if (!token) return next();

  try {
    const admin = await adminFromToken(token);
    if (!admin) return next(new Error('Invalid or expired token'));
    socket.data.admin = admin;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireSocketAdmin(socket) {
  if (!socket.data?.admin) {
    throw new Error('Admin authentication required');
  }
  return socket.data.admin;
}
