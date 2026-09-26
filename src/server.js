import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { loadEnv } from './config/env.js';
import { resolveSocketCorsOrigin } from './config/corsOrigins.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initChatSockets } from './sockets/chat.js';
import { initPush } from './services/push.js';
import { startConversationLifecycleJob } from './services/conversationLifecycle.js';
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
    cors: {
      origin: resolveSocketCorsOrigin(env.corsOrigin),
    },
  });
  initChatSockets(io);
  initPush();
  startConversationLifecycleJob();

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

/** True when this file is the process entry (node or PM2), not when imported by tests. */
function shouldAutoBoot() {
  if (process.env.NODE_ENV === 'test') return false;
  // PM2 sets pm_id on managed processes
  if (process.env.pm_id != null) return true;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return entry.includes('server.js');
  }
}

if (shouldAutoBoot()) {
  boot().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
