import http from 'http';
import { Server } from 'socket.io';
import { loadEnv } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initChatSockets } from './sockets/chat.js';
import { initPush } from './services/push.js';
import { logger } from './utils/logger.js';

/**
 * Boot the HTTP + Socket.io server.
 * @param {{ env?: NodeJS.ProcessEnv, listen?: boolean }} [options]
 */
export async function boot(options = {}) {
  const envSource = options.env || process.env;
  const shouldListen = options.listen !== false;

  const env = loadEnv(envSource);
  await connectDb(env.mongoUri);

  const app = createApp({ corsOrigin: env.corsOrigin });
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: env.corsOrigin || '*' },
  });
  initChatSockets(io);
  initPush();

  if (shouldListen) {
    await new Promise((resolve) => {
      server.listen(env.port, () => {
        logger.info(`Damic API listening on port ${env.port}`);
        resolve();
      });
    });
  }

  return { app, server, io, env };
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].includes('server.js'));

if (isMain && process.env.NODE_ENV !== 'test') {
  boot().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}