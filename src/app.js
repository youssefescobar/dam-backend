import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import quotesRouter from './routes/quotes.js';
import kbRouter from './routes/kb.js';
import chatRouter from './routes/chat.js';
import pushRouter from './routes/push.js';
import conversationsRouter from './routes/conversations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create Express application (no listen / no DB connect).
 * @param {{ corsOrigin?: string }} [options]
 */
export function createApp(options = {}) {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: options.corsOrigin || process.env.CORS_ORIGIN || '*',
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/quotes', quotesRouter);
  app.use('/kb', kbRouter);
  app.use('/chat', chatRouter);
  app.use('/push', pushRouter);
  app.use('/conversations', conversationsRouter);

  // Portable customer chat widget
  app.use('/widget', express.static(path.join(__dirname, '../public/widget')));

  app.use(errorHandler);

  return app;
}