import test from 'node:test';
import assert from 'node:assert/strict';

// The service imports the database config, which validates env at import time.
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createTaskService } = await import('../src/services/task.service.js');
const { AppError } = await import('../src/middleware/error-handler.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi' };
const TASK_ID = '11112222-3333-4444-5555-666677778888';

function fakeRepository() {
  const tasks = new Map();
  const history = [];
  const statusUpdates = [];

  return {
    tasks,
    history,
    statusUpdates,
    async create(_client, attributes) {
      const task = {
        id: TASK_ID,
        status: 'pending',
        scheduled_start: null,
        scheduled_end: null,
        ...attributes,
        title: attributes.title,
      };
      tasks.set(task.id, task);
      return task;
    },
    async insertHistory(_client, entry) {
      history.push(entry);
    },
    async findByPrefix(_client, userId, prefix) {
      const matches = [...tasks.values()].filter(
        (item) => item.userId === userId && item.id.startsWith(prefix)
      );
      return { ambiguous: matches.length > 1, task: matches[0] ?? null };
    },
    async updateStatus(_client, id, userId, status) {
      const task = tasks.get(id);
      const updated = { ...task, status };
      tasks.set(id, updated);
      statusUpdates.push({ id, userId, status });
      return updated;
    },
  };
}

function makeService() {
  const repo = fakeRepository();
  const service = createTaskService({
    repo,
    runInTransaction: async (callback) => callback({ fake: 'client' }),
  });
  return { repo, service };
}

test('createTask trims the title and records history', async () => {
  const { repo, service } = makeService();

  const task = await service.createTask(USER, { title: '  Revise chapter 4  ' });

  assert.equal(task.title, 'Revise chapter 4');
  assert.equal(task.userId, USER.id);
  assert.equal(task.status, 'pending');
  assert.equal(repo.history.length, 1);
  assert.equal(repo.history[0].eventType, 'created');
  assert.equal(repo.history[0].actor, 'user');
});

test('createTask rejects an empty title', async () => {
  const { service } = makeService();

  await assert.rejects(
    () => service.createTask(USER, { title: '   ' }),
    (error) => error instanceof AppError && error.code === 'TASK_TITLE_REQUIRED'
  );
});

test('createTask rejects an over-long title', async () => {
  const { service } = makeService();

  await assert.rejects(
    () => service.createTask(USER, { title: 'x'.repeat(201) }),
    (error) => error instanceof AppError && error.code === 'TASK_TITLE_TOO_LONG'
  );
});

test('completeTask updates status and records history', async () => {
  const { repo, service } = makeService();
  await service.createTask(USER, { title: 'Write report' });

  const updated = await service.completeTask(USER, TASK_ID.slice(0, 8));

  assert.equal(updated.status, 'completed');
  assert.deepEqual(repo.statusUpdates, [
    { id: TASK_ID, userId: USER.id, status: 'completed' },
  ]);

  const completedEvent = repo.history.at(-1);
  assert.equal(completedEvent.eventType, 'completed');
  assert.equal(completedEvent.oldStatus, 'pending');
  assert.equal(completedEvent.newStatus, 'completed');
});

test('completing a task twice is rejected', async () => {
  const { service } = makeService();
  await service.createTask(USER, { title: 'Write report' });
  await service.completeTask(USER, TASK_ID.slice(0, 8));

  await assert.rejects(
    () => service.completeTask(USER, TASK_ID.slice(0, 8)),
    (error) => error instanceof AppError && error.code === 'TASK_ALREADY_COMPLETED'
  );
});

test('an unknown task reference is rejected', async () => {
  const { service } = makeService();

  await assert.rejects(
    () => service.completeTask(USER, 'deadbeef'),
    (error) => error instanceof AppError && error.code === 'TASK_NOT_FOUND'
  );
});

test('a malformed task reference is rejected before querying', async () => {
  const { service } = makeService();

  await assert.rejects(
    () => service.completeTask(USER, 'not-a-task-ref'),
    (error) => error instanceof AppError && error.code === 'TASK_REFERENCE_INVALID'
  );
});

test('cancelTask marks the task cancelled', async () => {
  const { service } = makeService();
  await service.createTask(USER, { title: 'Old task' });

  const updated = await service.cancelTask(USER, TASK_ID.slice(0, 8));

  assert.equal(updated.status, 'cancelled');
});

test('tasks belong to the requesting user', async () => {
  const { service } = makeService();
  await service.createTask(USER, { title: 'Mine' });

  await assert.rejects(
    () => service.completeTask({ id: 'user-2' }, TASK_ID.slice(0, 8)),
    (error) => error instanceof AppError && error.code === 'TASK_NOT_FOUND'
  );
});
