import express from 'express';
import { env } from './config/env.js';
import webhookRoutes from './routes/webhook.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.use('/telegram', webhookRoutes);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
