import 'dotenv/config';
import { createApp } from './app.js';
import { env } from './config/env.js';
import http from 'http';

let server;
let shutdownPending = false;

async function start() {
  const app = createApp();

  server = http.createServer(app);

  server.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port}`);
    console.log(`[server] environment: ${env.nodeEnv}`);
    console.log(`[server] webhook path: /telegram/webhook`);
  });

  setupShutdown();
}

function setupShutdown() {
  const shutdown = async (signal) => {
    if (shutdownPending) return;
    shutdownPending = true;
    console.log(`[server] received ${signal}, shutting down gracefully...`);

    if (server) {
      server.close((err) => {
        if (err) {
          console.error('[server] error during server close:', err);
        } else {
          console.log('[server] http server closed');
        }
        process.exit(err ? 1 : 0);
      });
    } else {
      process.exit(0);
    }

    setTimeout(() => {
      console.error('[server] forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});

export { start };
