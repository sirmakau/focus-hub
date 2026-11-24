import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createCommandHandler, HELP_TEXT } = await import('../src/bot/commands.js');
const { AppError } = await import('../src/middleware/error-handler.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi', display_name: 'Sam' };

function makeHandler({ existingUser = USER, overrides = {} } = {}) {
  const sent = [];
  const calls = { created: [], completed: [], cancelled: [], registered: [] };

  const tasks = {
    async createTask(user, input) {
      calls.created.push({ user, input });
      return { id: 'abcd1234-0000-0000-0000-000000000000', title: input.title };
    },
    async completeTask(user, ref) {
      calls.completed.push({ user, ref });
      if (overrides.completeError) throw overrides.completeError;
      return { id: 'abcd1234-0000-0000-0000-000000000000', title: 'Write report' };
    },
    async cancelTask(user, ref) {
      calls.cancelled.push({ user, ref });
      return { id: 'abcd1234-0000-0000-0000-000000000000', title: 'Old task' };
    },
    async listTodayTasks() {
      return [
        {
          id: 'abcd1234-0000-0000-0000-000000000000',
          title: 'Morning Bible study',
          status: 'pending',
          scheduled_start: '2026-11-25T04:00:00.000Z',
          scheduled_end: '2026-11-25T04:30:00.000Z',
        },
      ];
    },
    async listPendingTasks() {
      return [];
    },
  };

  const users = {
    async findByTelegramId() {
      return existingUser;
    },
    async upsertFromTelegram(input) {
      calls.registered.push(input);
      return USER;
    },
  };

  const handler = createCommandHandler({
    send: async (chatId, text) => sent.push({ chatId, text }),
    tasks,
    users,
  });

  return { handler, sent, calls, tasks, users };
}

const BASE = { telegramId: 42, chatId: 42, displayName: 'Sam' };

test('/start registers the user and replies', async () => {
  const { handler, sent, calls } = makeHandler({ existingUser: null });

  await handler.handleMessage({ ...BASE, text: '/start' });

  assert.equal(calls.registered.length, 1);
  assert.equal(calls.registered[0].telegramId, 42);
  assert.match(sent[0].text, /Focus Hub ready/);
});

test('/help lists only implemented commands', async () => {
  const { handler, sent } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/help' });

  assert.equal(sent[0].text, HELP_TEXT);

  for (const implemented of ['/start', '/today', '/pending', '/add', '/done', '/cancel']) {
    assert.ok(HELP_TEXT.includes(implemented), `${implemented} should be documented`);
  }

  for (const missing of ['/tomorrow', '/week', '/progress', '/energy', '/review']) {
    assert.ok(!HELP_TEXT.includes(missing), `${missing} should not be advertised`);
  }
});

test('/today renders the schedule in the user timezone', async () => {
  const { handler, sent } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/today' });

  assert.match(sent[0].text, /📅 Today/);
  assert.match(sent[0].text, /07:00–07:30 · Morning Bible study/);
  assert.match(sent[0].text, /\[abcd1234\]/);
});

test('/pending shows a fallback when nothing is open', async () => {
  const { handler, sent } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/pending' });

  assert.match(sent[0].text, /No open tasks\./);
});

test('/add creates a task with the supplied title', async () => {
  const { handler, sent, calls } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/add Revise chapter 4' });

  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].input.title, 'Revise chapter 4');
  assert.match(sent[0].text, /Added "\[abcd1234\] Revise chapter 4"/);
});

test('commands with a bot suffix are still recognised', async () => {
  const { handler, calls } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/add@FocusHubBot Buy milk' });

  assert.equal(calls.created[0].input.title, 'Buy milk');
});

test('/done completes the referenced task', async () => {
  const { handler, sent, calls } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/done abcd1234' });

  assert.equal(calls.completed[0].ref, 'abcd1234');
  assert.match(sent[0].text, /✅ Completed/);
});

test('/done without a reference explains the usage', async () => {
  const { handler, sent, calls } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/done' });

  assert.equal(calls.completed.length, 0);
  assert.match(sent[0].text, /\/done 1a2b3c4d/);
});

test('service errors are reported to the user, not thrown', async () => {
  const { handler, sent } = makeHandler({
    overrides: {
      completeError: new AppError('No task found for that reference', {
        statusCode: 404,
        code: 'TASK_NOT_FOUND',
      }),
    },
  });

  await handler.handleMessage({ ...BASE, text: '/done deadbeef' });

  assert.match(sent[0].text, /No task found for that reference/);
});

test('unregistered users are told to run /start', async () => {
  const { handler, sent, calls } = makeHandler({ existingUser: null });

  await handler.handleMessage({ ...BASE, text: '/add Buy milk' });

  assert.equal(calls.created.length, 0);
  assert.match(sent[0].text, /Send \/start first/);
});

test('unknown commands and plain text get a helpful reply', async () => {
  const { handler, sent } = makeHandler();

  await handler.handleMessage({ ...BASE, text: '/tomorrow' });
  await handler.handleMessage({ ...BASE, text: 'hello there' });

  assert.match(sent[0].text, /do not know that command/);
  assert.match(sent[1].text, /only understand commands/);
});
