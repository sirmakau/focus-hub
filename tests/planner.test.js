import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createPlannerBot } = await import('../src/bot/planner.js');
const { AppError } = await import('../src/middleware/error-handler.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi', telegram_id: 42 };
const TASK_ID = 'aaaa1111-2222-3333-4444-555566667777';
const REF = 'aaaa1111';

const TASK = {
  id: TASK_ID,
  title: 'Morning Bible study',
  status: 'pending',
  priority: 'normal',
  scheduling_type: 'fixed',
  estimated_minutes: 30,
  scheduled_start: '2030-01-08T04:00:00.000Z',
  scheduled_end: '2030-01-08T04:30:00.000Z',
  deadline: null,
};

const WEEK_DAYS = [
  '2030-01-07',
  '2030-01-08',
  '2030-01-09',
  '2030-01-10',
  '2030-01-11',
  '2030-01-12',
  '2030-01-13',
];

function makeHarness({ user = USER, plansOverrides = {}, flowsOverrides = {} } = {}) {
  const calls = {
    sent: [],
    edits: [],
    answers: [],
    week: [],
    completed: [],
    cancelled: [],
    rescheduled: [],
    startAdd: [],
    setTitle: [],
  };

  const plans = {
    async week(_user, { offset = 0 } = {}) {
      calls.week.push(offset);
      return {
        monday: '2030-01-07',
        offset,
        today: '2030-01-08',
        weekLabel: 'Mon 7 Jan – Sun 13 Jan',
        days: WEEK_DAYS.map((date, index) => ({
          date,
          weekday: 'Monday',
          label: `Mon ${7 + index} Jan`,
          count: index,
          isToday: index === 1,
        })),
      };
    },
    async day(_user, date) {
      return {
        date,
        longLabel: `Tuesday 8 January 2030`,
        weekday: 'Tuesday',
        tasks: [TASK],
        events: [],
        unscheduled: [],
        energy: null,
        timeZone: USER.timezone,
      };
    },
    async taskCard() {
      return { task: TASK, category: { name: 'Faith' }, history: [], timeZone: USER.timezone };
    },
    async allTasks() {
      return { tasks: [TASK], page: 0, pages: 1, total: 1, timeZone: USER.timezone };
    },
    async unscheduled() {
      return { tasks: [], timeZone: USER.timezone };
    },
    async review() {
      return {
        week: { monday: '2030-01-07' },
        totals: { total: 1, completed: 0, open: 1 },
        unscheduledCount: 0,
        days: [{ date: '2030-01-07', total: 1, completed: 0 }],
      };
    },
    async listCategories() {
      return [{ id: 'cat-1', name: 'Faith' }];
    },
    async slots() {
      return {
        slots: [{ start: '09:00', end: '10:00' }],
        blockedReason: null,
        energy: null,
      };
    },
    async completeTask(_user, reference) {
      calls.completed.push(reference);
      return { ...TASK, status: 'completed' };
    },
    async cancelTask(_user, reference) {
      calls.cancelled.push(reference);
      return { ...TASK, status: 'cancelled' };
    },
    async reschedule(_user, options) {
      calls.rescheduled.push(options);
      return { ...TASK, scheduled_start: '2030-01-08T07:00:00.000Z' };
    },
    ...plansOverrides,
  };

  const flows = {
    async startAdd(_user, options) {
      calls.startAdd.push(options);
      return { flow: 'add_task', step: 'day', payload: {} };
    },
    async getState() {
      return null;
    },
    async setTitle(_user, title) {
      calls.setTitle.push(title);
      return { flow: 'add_task', step: 'type', payload: { title } };
    },
    ...flowsOverrides,
  };

  const bot = createPlannerBot({
    send: async (chatId, text, options) => calls.sent.push({ chatId, text, options }),
    edit: async (chatId, messageId, text, options) =>
      calls.edits.push({ chatId, messageId, text, options }),
    answer: async (callbackId, options) => calls.answers.push({ callbackId, options }),
    plans,
    flows,
    users: {
      async findByTelegramId() {
        return user;
      },
    },
  });

  return { bot, calls, plans, flows };
}

function callback(data, overrides = {}) {
  return {
    telegramId: USER.telegram_id,
    chatId: 42,
    callbackId: 'cb-1',
    messageId: 10,
    data,
    ...overrides,
  };
}

test('opening the dashboard shows the week with day buttons', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('home'));

  assert.deepEqual(calls.week, [0]);
  assert.equal(calls.edits.length, 1);
  assert.match(calls.edits[0].text, /Focus Hub — this week/);

  const dayButtons = calls.edits[0].options.reply_markup.inline_keyboard
    .flat()
    .filter((item) => item.callback_data.startsWith('d:'));
  assert.equal(dayButtons.length, 7);
});

test('previous and next week navigation reach the service and edit the menu', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('w:-1'));
  await bot.handleCallback(callback('w:1'));

  assert.deepEqual(calls.week, [-1, 1]);
  assert.equal(calls.edits.length, 2);
  assert.match(calls.edits[0].text, /week of/);
});

test('callback data is validated before any work happens', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('nonsense'));

  assert.equal(calls.week.length, 0);
  assert.equal(calls.answers.length, 1);
  assert.match(calls.answers[0].options.text, /out of date/);
});

test('callbacks from an unregistered telegram user are refused', async () => {
  const { bot, calls } = makeHarness({ user: null });

  await bot.handleCallback(callback('home'));

  assert.equal(calls.week.length, 0);
  assert.equal(calls.answers.length, 1);
  assert.equal(calls.answers[0].options.show_alert, true);
});

test('task buttons are scoped to the requesting user through the service', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`t:${REF}`));

  assert.equal(calls.edits.length, 1);
  assert.match(calls.edits[0].text, /Task: Morning Bible study/);
});

test('completing a task asks first, then records it', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`done:${REF}`));
  assert.match(calls.edits[0].text, /Did you complete this task\?/);
  assert.equal(calls.completed.length, 0);

  await bot.handleCallback(callback(`doney:${REF}`));
  assert.deepEqual(calls.completed, [REF]);
  assert.match(calls.edits[1].text, /Completed/);
});

test('cancelling a task asks first, then records it', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`cancel:${REF}`));
  assert.match(calls.edits[0].text, /Are you sure you want to cancel this task\?/);

  await bot.handleCallback(callback(`cancely:${REF}`));
  assert.deepEqual(calls.cancelled, [REF]);
});

test('a duplicate completion press is answered instead of crashing', async () => {
  const { bot, calls } = makeHarness({
    plansOverrides: {
      async completeTask() {
        throw new AppError('That task is already completed', {
          statusCode: 409,
          code: 'TASK_ALREADY_COMPLETED',
        });
      },
    },
  });

  await bot.handleCallback(callback(`doney:${REF}`));

  assert.equal(calls.answers.length, 1);
  assert.equal(calls.answers[0].options.show_alert, true);
  assert.match(calls.answers[0].options.text, /already completed/);
});

test('rescheduling suggests slots, asks for confirmation, then saves', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`rsd:${REF}:2030-01-09`));
  assert.match(calls.edits[0].text, /Choose a slot/);

  await bot.handleCallback(callback(`rss:${REF}:2030-01-09:09:00`));
  assert.match(calls.edits[1].text, /Move "Morning Bible study"\?/);
  assert.equal(calls.rescheduled.length, 0);

  await bot.handleCallback(callback(`rsy:${REF}:2030-01-09:09:00`));

  assert.equal(calls.rescheduled.length, 1);
  assert.deepEqual(calls.rescheduled[0], {
    reference: REF,
    date: '2030-01-09',
    time: '09:00',
  });
});

test('starting the add flow opens the day question', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('add'));

  assert.equal(calls.startAdd.length, 1);
  assert.match(calls.edits[0].text, /which day/);
});

test('a stale flow button is rejected when it no longer matches the step', async () => {
  const { bot, calls } = makeHarness({
    flowsOverrides: {
      async getState() {
        return { flow: 'add_task', step: 'title', payload: {} };
      },
    },
  });

  await bot.handleCallback(callback('ft:fixed'));

  assert.equal(calls.answers.length, 1);
  assert.match(calls.answers[0].options.text, /no longer open/);
});

test('choosing a day in the add flow advances to the title question', async () => {
  const { bot, calls } = makeHarness({
    flowsOverrides: {
      async getState() {
        return { flow: 'add_task', step: 'day', payload: {} };
      },
      async setDay(_user, date) {
        return { flow: 'add_task', step: 'title', payload: { date } };
      },
    },
  });

  await bot.handleCallback(callback('fd:2030-01-09'));

  assert.match(calls.edits[0].text, /what is the task/);
});

test('the confirmation button saves once and shows the saved card', async () => {
  let saved = 0;
  const { bot, calls } = makeHarness({
    flowsOverrides: {
      async getState() {
        return { flow: 'add_task', step: 'confirm', payload: {} };
      },
      async save() {
        saved += 1;
        return { task: TASK, duplicate: false };
      },
      async clear() {},
    },
  });

  await bot.handleCallback(callback('fsave'));

  assert.equal(saved, 1);
  assert.match(calls.edits[0].text, /Saved/);
  assert.equal(calls.answers[0].options.text, 'Saved');
});

test('plain text feeds the active flow and renders the next question', async () => {
  const { bot, calls } = makeHarness({
    flowsOverrides: {
      async getState() {
        return { flow: 'add_task', step: 'title', payload: {} };
      },
      async setTitle(_user, title) {
        calls.setTitle.push(title);
        return { flow: 'add_task', step: 'type', payload: { title } };
      },
    },
  });

  const handled = await bot.handleText({
    telegramId: USER.telegram_id,
    chatId: 42,
    text: 'Revise chapter 4',
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.setTitle, ['Revise chapter 4']);
  assert.match(calls.sent[0].text, /fixed or flexible/);
});

test('plain text outside a flow is left to the command handler', async () => {
  const { bot } = makeHarness();

  const handled = await bot.handleText({
    telegramId: USER.telegram_id,
    chatId: 42,
    text: 'hello',
  });

  assert.equal(handled, false);
});
