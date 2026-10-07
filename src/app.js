import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler.js';
import { resolveCorsOrigin } from './config/corsOrigins.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import quotesRouter from './routes/quotes.js';
import kbRouter from './routes/kb.js';
import chatRouter from './routes/chat.js';
import pushRouter from './routes/push.js';
import conversationsRouter from './routes/conversations.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';
import insightsRouter from './routes/insights.js';

/**
 * Create Express application (no listen / no DB connect).
 * @param {{ corsOrigin?: string }} [options]
 */
export function createApp(options = {}) {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      // Public API must be readable by the marketing site / admin on other origins.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(
    cors({
      origin: resolveCorsOrigin(options.corsOrigin || process.env.CORS_ORIGIN),
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
  app.use('/settings', settingsRouter);
  app.use('/reports', reportsRouter);
  app.use('/insights', insightsRouter);

  app.use(errorHandler);

  return app;
}
