import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createPlannerBot } = await import('../src/bot/planner.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi', telegram_id: 42 };
const TASK_ID = 'aaaa1111-2222-3333-4444-555566667777';
const EVENT_ID = 'bbbb2222-3333-4444-5555-666677778888';
const REF = 'aaaa1111';
const EVENT_REF = 'bbbb2222';

const TASK = {
  id: TASK_ID,
  title: 'Morning Bible study',
  status: 'pending',
  priority: 'normal',
  scheduling_type: 'fixed',
  estimated_minutes: 30,
  scheduled_start: '2030-01-09T18:00:00.000Z',
  scheduled_end: '2030-01-09T18:30:00.000Z',
  deadline: null,
};

const EVENT = {
  id: EVENT_ID,
  title: 'Evening review',
  description: 'Review the day',
  is_fixed: true,
  starts_at: '2030-01-09T17:00:00.000Z',
  ends_at: '2030-01-09T17:30:00.000Z',
};

const HISTORY = [
  {
    id: 'cccc3333-0000-0000-0000-000000000000',
    event_type: 'rescheduled',
    actor: 'user',
    details: { previous: { scheduledStart: '2030-01-09T18:00:00.000Z' } },
  },
];

function makeHarness({ flowsOverrides = {}, plansOverrides = {} } = {}) {
  const calls = { edits: [], answers: [], undone: [], applied: [], schedule: [] };

  const plans = {
    async day(_user, date) {
      return {
        date,
        longLabel: 'Wednesday 9 January 2030',
        weekday: 'Wednesday',
        tasks: [TASK],
        events: [EVENT],
        unscheduled: [],
        energy: null,
        timeZone: USER.timezone,
      };
    },
    async taskCard() {
      return { task: TASK, category: null, history: HISTORY, timeZone: USER.timezone };
    },
    async eventCard() {
      return { event: EVENT, history: HISTORY, timeZone: USER.timezone };
    },
    async listCategories() {
      return [];
    },
    async undoChange(_user, options) {
      calls.undone.push(options);
      return { kind: options.kind, item: options.kind === 'event' ? EVENT : TASK };
    },
    async deleteEvent() {
      return { event: { ...EVENT }, undoRef: 'dddd4444' };
    },
    ...plansOverrides,
  };

  const flows = {
    async getState() {
      return null;
    },
    async startSchedule(_user, { item, kind = 'task' }) {
      return {
        flow: 'edit_schedule',
        step: 'schedule_start',
        payload: { kind, ref: item.id.slice(0, 8), title: item.title, date: '2030-01-09' },
      };
    },
    async keepScheduleEnd() {
      return {
        flow: 'edit_schedule',
        step: 'schedule_confirm',
        payload: {
          kind: 'task',
          ref: REF,
          title: TASK.title,
          date: '2030-01-09',
          start: '20:00',
          end: '20:30',
          originalDate: '2030-01-09',
          originalStart: '21:00',
          originalEnd: '21:30',
          isFixed: true,
          conflict: {
            kind: 'event',
            title: 'Evening review',
            startsAt: '2030-01-09T17:00:00.000Z',
            endsAt: '2030-01-09T17:30:00.000Z',
          },
        },
      };
    },
    async saveSchedule(_user, options) {
      calls.schedule.push(options);
      return {
        kind: 'task',
        item: TASK,
        undoRef: 'aaaa0000',
        acceptedConflict: Boolean(options.acceptConflict),
      };
    },
    async applyEdit(_user, field, value) {
      calls.applied.push({ field, value });
      return { kind: 'event', item: EVENT, field, undoRef: 'aaaa0000' };
    },
    ...flowsOverrides,
  };

  const bot = createPlannerBot({
    send: async () => {},
    edit: async (_chatId, _messageId, text, options) => calls.edits.push({ text, options }),
    answer: async (_callbackId, options) => calls.answers.push(options),
    plans,
    flows,
    users: {
      async findByTelegramId() {
        return USER;
      },
    },
  });

  return { bot, calls };
}

function callback(data) {
  return {
    telegramId: USER.telegram_id,
    chatId: 42,
    callbackId: 'cb-1',
    messageId: 10,
    data,
  };
}

function buttons(text) {
  const last = text.at(-1);
  return last.options.reply_markup.inline_keyboard.flat();
}

test('the day view offers a button for each calendar commitment', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('d:2030-01-09'));

  const labels = buttons(calls.edits).map((item) => item.callback_data);
  assert.ok(labels.includes(`ev:${EVENT_REF}`));
  assert.ok(labels.includes(`t:${REF}`));
});

test('a fixed commitment card explains that manual changes are allowed', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`ev:${EVENT_REF}`));

  const text = calls.edits.at(-1).text;
  assert.match(text, /Commitment: Evening review/);
  assert.match(text, /automatic scheduling will never move it/i);
  assert.match(text, /You can still edit or move it yourself/);
});

test('the confirmation step spells out the conflict and offers Save anyway', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('eske'));

  const edit = calls.edits.at(-1);
  assert.match(edit.text, /Current: /);
  assert.match(edit.text, /New: /);
  assert.match(edit.text, /overlaps "Evening review"/);
  assert.match(edit.text, /double-books/);

  const data = edit.options.reply_markup.inline_keyboard.flat().map((item) => item.callback_data);
  assert.ok(data.includes('esfc'));
});

test('saving with a conflict is explicit and nothing else is moved', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback('esfc'));

  assert.equal(calls.schedule.length, 1);
  assert.equal(calls.schedule[0].acceptConflict, true);
  assert.match(calls.edits.at(-1).text, /Saved with a conflict/);
});

test('undo uses the history reference and restores the task card', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`undo:${REF}:cccc3333`));

  assert.deepEqual(calls.undone[0], {
    kind: 'task',
    reference: REF,
    undoRef: 'cccc3333',
  });
  assert.match(calls.edits.at(-1).text, /Change undone/);
});

test('a fixed calendar commitment can be switched to flexible by its owner', async () => {
  const { bot, calls } = makeHarness({
    flowsOverrides: {
      async getState() {
        return { flow: 'edit_task', step: 'edit_menu', payload: { kind: 'event' } };
      },
    },
  });

  await bot.handleCallback(callback(`evf:${EVENT_REF}:flexible`));

  assert.deepEqual(calls.applied[0], { field: 'type', value: 'flexible' });
  assert.match(calls.edits.at(-1).text, /Marked as flexible/);
});

test('starting an exact time change opens the schedule flow', async () => {
  const { bot, calls } = makeHarness();

  await bot.handleCallback(callback(`ew:${REF}`));

  assert.match(calls.edits.at(-1).text, /What should the new start time be\?/);
});
