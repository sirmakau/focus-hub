import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createPlanService } = await import('../src/services/plan.service.js');
const { AppError } = await import('../src/middleware/error-handler.js');
const { zonedWallTimeToUtc } = await import('../src/utils/dates.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi' };
const TASK_ID = 'aaaa1111-2222-3333-4444-555566667777';

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    user_id: USER.id,
    title: 'Revise chapter 4',
    status: 'pending',
    priority: 'normal',
    scheduling_type: 'flexible',
    auto_reschedule: true,
    estimated_minutes: 60,
    scheduled_start: null,
    scheduled_end: null,
    deadline: null,
    ...overrides,
  };
}

function makeHarness({ task = makeTask(), dayTasks = [], events = [], energy = null } = {}) {
  const calls = { schedules: [], history: [], updates: [] };

  const tasks = {
    async findScheduledBetween() {
      return dayTasks;
    },
    async findScheduledOnDate() {
      return dayTasks;
    },
    async findUnscheduled() {
      return [];
    },
    async countOpen() {
      return 0;
    },
    async findOpenPage() {
      return [];
    },
    async findHistory() {
      return [];
    },
    async updateSchedule(_client, id, userId, schedule) {
      calls.schedules.push({ id, userId, ...schedule });
      return { ...task, scheduled_start: schedule.scheduledStart, scheduled_end: schedule.scheduledEnd };
    },
    async updateFields(_client, id, userId, fields) {
      calls.updates.push({ id, userId, fields });
      return { ...task, ...fields };
    },
    async insertHistory(_client, entry) {
      calls.history.push(entry);
    },
  };

  const calendars = {
    async findForDay() {
      return events;
    },
  };

  const categories = {
    async listForUser() {
      return [];
    },
    async ensureDefaults() {},
  };

  const energies = {
    async findLatest() {
      return energy;
    },
  };

  const taskService = {
    async getTask() {
      return task;
    },
  };

  const service = createPlanService({
    tasks,
    calendars,
    categories,
    energies,
    taskService,
    runInTransaction: async (callback) => callback({ fake: true }),
  });

  return { service, calls };
}

test('week counts tasks by local calendar date', async () => {
  const rows = [
    makeTask({
      id: 'one',
      scheduled_start: zonedWallTimeToUtc('2030-01-07', '07:00', 'Africa/Nairobi'),
    }),
    makeTask({
      id: 'two',
      scheduled_start: zonedWallTimeToUtc('2030-01-07', '08:00', 'Africa/Nairobi'),
    }),
    makeTask({
      id: 'three',
      scheduled_start: zonedWallTimeToUtc('2030-01-13', '22:00', 'Africa/Nairobi'),
    }),
  ];

  const { service } = makeHarness({ dayTasks: rows });
  const week = await service.week(USER, { offset: 0, now: new Date('2030-01-08T09:00:00Z') });

  assert.equal(week.monday, '2030-01-07');
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].count, 2);
  assert.equal(week.days[6].count, 1);
});

test('day view separates commitments, scheduled tasks and unscheduled tasks', async () => {
  const event = {
    id: 'e1',
    title: 'University lecture',
    starts_at: zonedWallTimeToUtc('2030-01-08', '09:00', 'Africa/Nairobi'),
    ends_at: zonedWallTimeToUtc('2030-01-08', '11:00', 'Africa/Nairobi'),
  };
  const task = makeTask({
    scheduled_start: zonedWallTimeToUtc('2030-01-08', '07:00', 'Africa/Nairobi'),
    scheduled_end: zonedWallTimeToUtc('2030-01-08', '07:30', 'Africa/Nairobi'),
  });

  const { service } = makeHarness({ dayTasks: [task], events: [event] });
  const day = await service.day(USER, '2030-01-08');

  assert.equal(day.events.length, 1);
  assert.equal(day.tasks.length, 1);
  assert.deepEqual(day.unscheduled, []);
  assert.equal(day.energy, null);
});

test('rescheduling writes history with old and new schedule', async () => {
  const { service, calls } = makeHarness();

  await service.reschedule(USER, {
    reference: 'aaaa1111',
    date: '2030-01-08',
    time: '14:00',
  });

  assert.equal(calls.schedules.length, 1);
  assert.equal(
    calls.schedules[0].scheduledStart.toISOString(),
    zonedWallTimeToUtc('2030-01-08', '14:00', 'Africa/Nairobi').toISOString()
  );

  const change = calls.history.at(-1);
  assert.equal(change.eventType, 'rescheduled');
  assert.equal(change.actor, 'user');
  assert.equal(change.oldScheduledStart, null);
  assert.ok(change.newScheduledStart instanceof Date);
});

test('rescheduling into an existing commitment is refused', async () => {
  const lecture = makeTask({
    id: 'lecture',
    title: 'University lecture',
    scheduling_type: 'fixed',
    scheduled_start: zonedWallTimeToUtc('2030-01-08', '10:00', 'Africa/Nairobi'),
    scheduled_end: zonedWallTimeToUtc('2030-01-08', '11:00', 'Africa/Nairobi'),
  });

  const { service, calls } = makeHarness({ dayTasks: [lecture] });

  await assert.rejects(
    () =>
      service.reschedule(USER, {
        reference: 'aaaa1111',
        date: '2030-01-08',
        time: '10:30',
      }),
    (error) =>
      error instanceof AppError && error.code === 'SCHEDULE_CONFLICT'
  );

  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.history.length, 0);
});

test('sleep hours are protected', async () => {
  const { service } = makeHarness();

  await assert.rejects(
    () =>
      service.reschedule(USER, {
        reference: 'aaaa1111',
        date: '2030-01-08',
        time: '05:30',
      }),
    (error) => error.code === 'OUTSIDE_WAKING_HOURS'
  );
});

test('a deadline cannot be broken by a reschedule', async () => {
  const task = makeTask({
    deadline: zonedWallTimeToUtc('2030-01-08', '12:00', 'Africa/Nairobi'),
  });

  const { service } = makeHarness({ task });

  await assert.rejects(
    () =>
      service.reschedule(USER, {
        reference: 'aaaa1111',
        date: '2030-01-08',
        time: '11:30',
      }),
    (error) => error.code === 'DEADLINE_CONFLICT'
  );
});

test('fixed commitments are never moved automatically', async () => {
  const task = makeTask({ scheduling_type: 'fixed' });
  const { service, calls } = makeHarness({ task });

  await assert.rejects(
    () =>
      service.autoReschedule(USER, {
        reference: 'aaaa1111',
        date: '2030-01-08',
        time: '14:00',
      }),
    (error) =>
      error instanceof AppError && error.code === 'FIXED_COMMITMENT_PROTECTED'
  );

  assert.equal(calls.schedules.length, 0);
});

test('flexible tasks can be moved automatically and are logged as system', async () => {
  const { service, calls } = makeHarness();

  await service.autoReschedule(USER, {
    reference: 'aaaa1111',
    date: '2030-01-08',
    time: '14:00',
  });

  assert.equal(calls.history.at(-1).actor, 'system');
});

test('weekly review counts completed against scheduled work', async () => {
  const rows = [
    makeTask({
      id: 'one',
      status: 'completed',
      scheduled_start: zonedWallTimeToUtc('2030-01-07', '07:00', 'Africa/Nairobi'),
    }),
    makeTask({
      id: 'two',
      status: 'pending',
      scheduled_start: zonedWallTimeToUtc('2030-01-08', '08:00', 'Africa/Nairobi'),
    }),
  ];

  const { service } = makeHarness({ dayTasks: rows });
  const review = await service.review(USER, {
    offset: 0,
    now: new Date('2030-01-08T09:00:00Z'),
  });

  assert.equal(review.totals.total, 2);
  assert.equal(review.totals.completed, 1);
  assert.equal(review.totals.open, 1);
});
