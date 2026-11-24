import express from 'express';
import { env } from './config/env.js';
import { ping } from './config/database.js';
import webhookRoutes from './routes/webhook.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.use('/telegram', webhookRoutes);

  app.get('/health', async (_req, res) => {
    let database = 'up';

    try {
      await ping();
    } catch (error) {
      database = 'down';
      console.error('[health] database check failed:', error.message);
    }

    res.json({
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
