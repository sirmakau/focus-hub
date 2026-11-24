import 'dotenv/config';
import { createApp } from './app.js';
import { env } from './config/env.js';
import http from 'http';
import { ping } from './config/database.js';

async function run() {
  let databaseOk = false;
  let databaseError = null;

  let app;

  try {
    const now = await ping();
    databaseOk = true;
    console.log('[health] database reachable, server time:', now);
  } catch (error) {
    databaseError = error;
    console.error('[health] database reachability check failed:', error.message);
  }

  app = createApp();
  const server = http.createServer(app);

  const port = env.port;

  server.listen(port, () => {
    console.log(`[health] health server listening on port ${port}`);
  });

  // APP_URL may be configured with or without a trailing slash, so resolve
  // the health path against it instead of concatenating strings.
  const baseUrl =
    env.nodeEnv === 'production'
      ? env.appUrl.startsWith('http')
        ? env.appUrl
        : `https://${env.appUrl}`
      : `http://localhost:${port}`;

  const healthPath = new URL('/health', baseUrl).toString();

  console.log('[health] checking application health endpoint:', healthPath);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(healthPath, {
      method: 'GET',
      signal: controller.signal,
    });
    const body = await response.json();
    console.log('[health] application health:', JSON.stringify(body, null, 2));
  } catch (error) {
    console.error('[health] failed to reach health endpoint:', error.message);
  } finally {
    clearTimeout(timeout);
    server.close(() => {
      console.log('[health] health server closed');
      process.exit(databaseOk ? 0 : 1);
    });
  }
}

run().catch((error) => {
  console.error('[health] fatal:', error);
  process.exit(1);
});
