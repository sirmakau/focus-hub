import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// app.js loads env.js at import time, which requires these to be present.
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.AUTHORIZED_TELEGRAM_USER_IDS = '8806308727';
// Deliberately unreachable so the health route reports a degraded database
// without touching the real Neon instance.
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

function post(body, headers = {}) {
  return fetch(`${baseUrl}/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

const SECRET_HEADER = { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' };

test('GET /health reports status and database state', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.database, 'down');
  assert.equal(body.status, 'degraded');
  assert.equal(body.environment, 'test');
  assert.ok(typeof body.timestamp === 'string');
});

test('webhook rejects a request with no secret', async () => {
  const response = await post(JSON.stringify({ update_id: 1 }));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'WEBHOOK_AUTH_FAILED');
});

test('webhook rejects a request with the wrong secret', async () => {
  const response = await post(JSON.stringify({ update_id: 2 }), {
    'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
  });

  assert.equal(response.status, 401);
});

test('webhook accepts the Telegram secret header', async () => {
  const response = await post(JSON.stringify({ update_id: 3 }), SECRET_HEADER);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
});

test('webhook accepts the legacy query secret', async () => {
  const response = await fetch(
    `${baseUrl}/telegram/webhook?secret=test-secret`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 4 }),
    }
  );

  assert.equal(response.status, 200);
});

test('malformed JSON is rejected with 400, not 500', async () => {
  const response = await post('{"update_id": ', SECRET_HEADER);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
});

test('update without a known Telegram type is acknowledged', async () => {
  const response = await post(
    JSON.stringify({ update_id: 5, poll: { id: 'x' } }),
    SECRET_HEADER
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
});

test('an unauthorized user is acknowledged and ignored', async () => {
  const response = await post(
    JSON.stringify({
      update_id: 6,
      message: {
        message_id: 1,
        from: { id: 111 },
        chat: { id: 111, type: 'private' },
        date: 1,
        text: '/start',
      },
    }),
    SECRET_HEADER
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: true });
});

test('a repeated update_id is acknowledged as a duplicate', async () => {
  const payload = JSON.stringify({ update_id: 7, poll: { id: 'x' } });

  const first = await post(payload, SECRET_HEADER);
  assert.deepEqual(await first.json(), { received: true });

  const second = await post(payload, SECRET_HEADER);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { received: true, duplicate: true });
});

test('unknown routes return the JSON not-found shape', async () => {
  const response = await fetch(`${baseUrl}/nope`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});
