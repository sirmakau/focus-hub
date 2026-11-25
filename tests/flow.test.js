import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createFlowService } = await import('../src/services/flow.service.js');
const { zonedWallTimeToUtc } = await import('../src/utils/dates.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi' };
const TASK_ID = 'bbbb2222-3333-4444-5555-666677778888';

function fakeSessions() {
  let state = null;

  return {
    peek: () => state,
    async get() {
      return state;
    },
    async start(_user, { flow, step, payload = {} }) {
      state = { flow, step, payload, expires_at: new Date(Date.now() + 1800000) };
      return state;
    },
    async update(_user, { step, payload }) {
      state = {
        ...state,
        step: step ?? state.step,
        payload: payload ?? state.payload,
      };
      return state;
    },
    async clear() {
      state = null;
    },
  };
}

function fakePlans({ slotError = null } = {}) {
  const created = [];
  const slotChecks = [];

  return {
    created,
    slotChecks,
    async assertSlotAvailable(_user, options) {
      slotChecks.push(options);
      if (slotError) throw slotError;
    },
    async createTask(_user, input) {
      created.push(input);
      return {
        id: TASK_ID,
        title: input.title,
        scheduled_start: input.scheduledStart,
        scheduled_end: input.scheduledEnd,
        status: 'pending',
      };
    },
    async taskCard() {
      return { task: { id: TASK_ID, title: 'Saved task' } };
    },
    async editTask(_user, reference, fields) {
      return { id: TASK_ID, title: fields.title ?? 'Edited task', ...fields };
    },
  };
}

function makeHarness(options = {}) {
  const sessions = fakeSessions();
  const plans = fakePlans(options);
  const flow = createFlowService({ sessions, plans });
  return { flow, sessions, plans };
}

async function completeAnswers(flow) {
  await flow.startAdd(USER);
  await flow.setDay(USER, '2030-01-08');
  await flow.setTitle(USER, 'Revise chapter 4');
  await flow.setType(USER, 'flexible');
  await flow.setCategory(USER, { id: 'cat-1', name: 'University' });
  await flow.setPriority(USER, 'high');
  await flow.setDuration(USER, 60);
  await flow.setTime(USER, '09:30');
  await flow.setDeadline(USER, null);
}

test('guided creation asks one question at a time', async () => {
  const { flow } = makeHarness();

  let session = await flow.startAdd(USER);
  assert.equal(session.step, 'day');

  session = await flow.setDay(USER, '2030-01-08');
  assert.equal(session.step, 'title');

  session = await flow.setTitle(USER, '  Revise chapter 4  ');
  assert.equal(session.step, 'type');
  assert.equal(session.payload.title, 'Revise chapter 4');

  session = await flow.setType(USER, 'fixed');
  assert.equal(session.step, 'category');

  session = await flow.setCategory(USER, null);
  assert.equal(session.step, 'priority');
  assert.equal(session.payload.categoryId, null);
});

test('saving requires an explicit confirmation step', async () => {
  const { flow } = makeHarness();

  await flow.startAdd(USER);
  await flow.setDay(USER, '2030-01-08');
  await flow.setTitle(USER, 'Write report');

  await assert.rejects(
    () => flow.save(USER),
    (error) => error.code === 'FLOW_STEP_MISMATCH'
  );
});

test('a confirmed task is saved with every answer applied', async () => {
  const { flow, plans, sessions } = makeHarness();
  await completeAnswers(flow);

  const result = await flow.save(USER);

  assert.equal(result.duplicate, false);
  assert.equal(plans.created.length, 1);

  const input = plans.created[0];
  assert.equal(input.title, 'Revise chapter 4');
  assert.equal(input.priority, 'high');
  assert.equal(input.schedulingType, 'flexible');
  assert.equal(input.categoryId, 'cat-1');
  assert.equal(input.estimatedMinutes, 60);
  assert.equal(
    input.scheduledStart.toISOString(),
    zonedWallTimeToUtc('2030-01-08', '09:30', 'Africa/Nairobi').toISOString()
  );
  assert.equal(
    input.scheduledEnd.getTime() - input.scheduledStart.getTime(),
    60 * 60000
  );

  assert.equal(sessions.peek().payload.savedTaskId, TASK_ID);
});

test('pressing save twice does not create a second task', async () => {
  const { flow, plans } = makeHarness();
  await completeAnswers(flow);

  const first = await flow.save(USER);
  const second = await flow.save(USER);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(plans.created.length, 1);
});

test('leaving a task unscheduled skips the slot check', async () => {
  const { flow, plans } = makeHarness();

  await flow.startAdd(USER);
  await flow.setDay(USER, '2030-01-08');
  await flow.setTitle(USER, 'Buy groceries');
  await flow.setType(USER, 'flexible');
  await flow.setCategory(USER, null);
  await flow.setPriority(USER, 'normal');
  await flow.setDuration(USER, 30);
  await flow.setTime(USER, null);
  await flow.setDeadline(USER, null);

  const result = await flow.save(USER);

  assert.equal(plans.slotChecks.length, 0);
  assert.equal(plans.created[0].scheduledStart, null);
  assert.equal(result.duplicate, false);
});

test('a conflicting slot stops the save', async () => {
  const { AppError } = await import('../src/middleware/error-handler.js');
  const { flow, plans } = makeHarness({
    slotError: new AppError('That overlaps something else', {
      statusCode: 409,
      code: 'SCHEDULE_CONFLICT',
    }),
  });
  await completeAnswers(flow);

  await assert.rejects(
    () => flow.save(USER),
    (error) => error.code === 'SCHEDULE_CONFLICT'
  );
  assert.equal(plans.created.length, 0);
});

test('a deadline is normalised to the end of that local day', async () => {
  const { flow } = makeHarness();
  await completeAnswers(flow);

  const session = await flow.setDeadline(USER, '2030-01-10');

  assert.equal(
    new Date(session.payload.deadline).toISOString(),
    zonedWallTimeToUtc('2030-01-11', '00:00', 'Africa/Nairobi').toISOString()
  );
});

test('an expired form refuses further answers', async () => {
  const { flow } = makeHarness();

  await assert.rejects(
    () => flow.setDay(USER, '2030-01-08'),
    (error) => error.code === 'FLOW_EXPIRED'
  );
});

test('cancelling discards the whole form', async () => {
  const { flow, sessions } = makeHarness();
  await flow.startAdd(USER);

  await flow.clear(USER);

  assert.equal(sessions.peek(), null);
});

test('editing applies the change immediately and closes the form', async () => {
  const { flow, sessions } = makeHarness();

  await sessions.start(USER, {
    flow: 'edit_task',
    step: 'edit_menu',
    payload: { taskRef: 'bbbb2222' },
  });

  const result = await flow.applyEdit(USER, 'priority', 'urgent');

  assert.equal(result.field, 'priority');
  assert.equal(sessions.peek(), null);
});
