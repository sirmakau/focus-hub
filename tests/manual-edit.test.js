import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/focus_hub_test';

const { createPlanService } = await import('../src/services/plan.service.js');
const { createFlowService } = await import('../src/services/flow.service.js');
const { zonedWallTimeToUtc, zonedDateOf } = await import('../src/utils/dates.js');

const USER = { id: 'user-1', timezone: 'Africa/Nairobi' };
const TASK_ID = 'aaaa1111-2222-3333-4444-555566667777';
const EVENT_ID = 'bbbb2222-3333-4444-5555-666677778888';

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    user_id: USER.id,
    title: 'Morning Bible study',
    description: null,
    status: 'pending',
    priority: 'normal',
    category_id: null,
    scheduling_type: 'fixed',
    auto_reschedule: false,
    estimated_minutes: 30,
    scheduled_start: zonedWallTimeToUtc('2030-01-09', '21:00', USER.timezone),
    scheduled_end: zonedWallTimeToUtc('2030-01-09', '21:30', USER.timezone),
    deadline: null,
    completed_at: null,
    created_at: new Date('2030-01-01T00:00:00Z'),
    updated_at: new Date('2030-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    user_id: USER.id,
    title: 'Evening review',
    description: 'Review the day',
    event_type: 'commitment',
    location: null,
    starts_at: zonedWallTimeToUtc('2030-01-09', '20:00', USER.timezone),
    ends_at: zonedWallTimeToUtc('2030-01-09', '20:30', USER.timezone),
    is_fixed: true,
    recurrence_rule: null,
    created_at: new Date('2030-01-01T00:00:00Z'),
    updated_at: new Date('2030-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

let historyCounter = 0;
function historyId(prefix) {
  historyCounter += 1;
  return `${prefix}${String(historyCounter).padStart(7, '0')}-0000-0000-0000-000000000000`;
}

function makeHarness({ task = makeTask(), events = [makeEvent()], dayTasks = null } = {}) {
  const state = {
    tasks: [task],
    events: [...events],
    taskHistory: [],
    eventHistory: [],
    scheduleWrites: [],
    fieldWrites: [],
  };

  const tasksRepo = {
    async findScheduledOnDate(_client, userId, timeZone, date) {
      return (dayTasks ?? state.tasks).filter(
        (item) =>
          item.user_id === userId &&
          item.status !== 'cancelled' &&
          item.scheduled_start &&
          zonedDateOf(item.scheduled_start, timeZone) === date
      );
    },
    async findScheduledBetween(_client, userId, from, to) {
      return state.tasks.filter(
        (item) =>
          item.scheduled_start &&
          new Date(item.scheduled_start) >= from &&
          new Date(item.scheduled_start) < to
      );
    },
    async findUnscheduled() {
      return [];
    },
    async countOpen() {
      return state.tasks.length;
    },
    async findOpenPage() {
      return [];
    },
    async findHistory(_client, taskId) {
      return state.taskHistory
        .filter((row) => row.taskId === taskId)
        .slice()
        .reverse();
    },
    async findHistoryByPrefix(_client, userId, taskId, prefix) {
      const entry = state.taskHistory
        .filter((row) => row.taskId === taskId && row.id.startsWith(prefix))
        .at(-1);
      return { ambiguous: false, entry: entry ?? null };
    },
    async updateSchedule(_client, id, userId, schedule) {
      const index = state.tasks.findIndex((row) => row.id === id);
      const item = {
        ...state.tasks[index],
        scheduled_start: schedule.scheduledStart,
        scheduled_end: schedule.scheduledEnd,
      };
      state.tasks[index] = item;
      state.scheduleWrites.push({ id, ...schedule });
      return { ...item };
    },
    async updateFields(_client, id, userId, fields) {
      const index = state.tasks.findIndex((row) => row.id === id);
      const item = {
        ...state.tasks[index],
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
        ...(fields.categoryId !== undefined ? { category_id: fields.categoryId } : {}),
        ...(fields.schedulingType !== undefined
          ? { scheduling_type: fields.schedulingType }
          : {}),
        ...(fields.estimatedMinutes !== undefined
          ? { estimated_minutes: fields.estimatedMinutes }
          : {}),
        ...(fields.deadline !== undefined ? { deadline: fields.deadline } : {}),
      };
      state.tasks[index] = item;
      state.fieldWrites.push({ id, fields });
      return { ...item };
    },
    async insertHistory(_client, entry) {
      const id = historyId('aaaa0000');
      state.taskHistory.push({ ...entry, id, event_type: entry.eventType });
      return id;
    },
  };

  const calendarRepo = {
    async findBetween(_client, userId, from, to) {
      return state.events.filter(
        (event) =>
          event.user_id === userId &&
          !event.deleted_at &&
          new Date(event.starts_at) < to &&
          new Date(event.ends_at) > from
      );
    },
    async findForDay(_client, userId, from, to) {
      return this.findBetween(null, userId, from, to);
    },
    async findByPrefix(_client, userId, prefix, { includeDeleted = false } = {}) {
      const event = state.events.find(
        (row) =>
          row.user_id === userId &&
          row.id.startsWith(prefix) &&
          (includeDeleted || !row.deleted_at)
      );
      return { ambiguous: false, event: event ?? null };
    },
    async updateEvent(_client, id, userId, fields) {
      const index = state.events.findIndex((row) => row.id === id);
      const event = {
        ...state.events[index],
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.startsAt !== undefined ? { starts_at: fields.startsAt } : {}),
        ...(fields.endsAt !== undefined ? { ends_at: fields.endsAt } : {}),
        ...(fields.isFixed !== undefined ? { is_fixed: fields.isFixed } : {}),
      };
      state.events[index] = event;
      return { ...event };
    },
    async softDelete(_client, id, userId) {
      const index = state.events.findIndex((row) => row.id === id);
      const event = {
        ...state.events[index],
        deleted_at: new Date('2030-02-01T00:00:00Z'),
      };
      state.events[index] = event;
      return { ...event };
    },
    async restore(_client, id, userId, fields = {}) {
      const index = state.events.findIndex((row) => row.id === id);
      const event = {
        ...state.events[index],
        deleted_at: null,
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.startsAt !== undefined ? { starts_at: fields.startsAt } : {}),
        ...(fields.endsAt !== undefined ? { ends_at: fields.endsAt } : {}),
        ...(fields.isFixed !== undefined ? { is_fixed: fields.isFixed } : {}),
      };
      state.events[index] = event;
      return { ...event };
    },
    async insertHistory(_client, entry) {
      const id = historyId('bbbb0000');
      state.eventHistory.push({
        ...entry,
        id,
        event_type: entry.eventType,
        old_title: entry.oldTitle ?? null,
        new_title: entry.newTitle ?? null,
        old_description: entry.oldDescription ?? null,
        new_description: entry.newDescription ?? null,
        old_starts_at: entry.oldStartsAt ?? null,
        new_starts_at: entry.newStartsAt ?? null,
        old_ends_at: entry.oldEndsAt ?? null,
        new_ends_at: entry.newEndsAt ?? null,
        old_is_fixed: entry.oldIsFixed ?? null,
        new_is_fixed: entry.newIsFixed ?? null,
      });
      return id;
    },
    async findHistory(_client, eventId) {
      return state.eventHistory
        .filter((row) => row.eventId === eventId)
        .slice()
        .reverse();
    },
    async findHistoryByPrefix(_client, userId, eventId, prefix) {
      const entry = state.eventHistory
        .filter((row) => row.eventId === eventId && row.id.startsWith(prefix))
        .at(-1);
      return { ambiguous: false, entry: entry ?? null };
    },
  };

  const plan = createPlanService({
    tasks: tasksRepo,
    calendars: calendarRepo,
    categories: {
      async listForUser() {
        return [];
      },
      async ensureDefaults() {},
    },
    energies: {
      async findLatest() {
        return null;
      },
    },
    taskService: {
      async getTask(_user, reference) {
        return state.tasks.find((row) => row.id.startsWith(reference));
      },
    },
    runInTransaction: async (callback) => callback({ fake: true }),
  });

  return { plan, state, tasksRepo, calendarRepo };
}

function fakeSessions() {
  let state = null;

  return {
    peek: () => state,
    async get() {
      return state;
    },
    async start(_user, { flow, step, payload = {} }) {
      state = { flow, step, payload };
      return state;
    },
    async update(_user, { step, payload }) {
      state = { ...state, step: step ?? state.step, payload: payload ?? state.payload };
      return state;
    },
    async clear() {
      state = null;
    },
  };
}

test('a fixed task can be edited and moved explicitly, and is logged as the user', async () => {
  const { plan, state } = makeHarness();

  const result = await plan.saveScheduledChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    date: '2030-01-09',
    start: '21:15',
    end: '21:45',
  });

  assert.equal(
    result.item.scheduled_start.toISOString(),
    zonedWallTimeToUtc('2030-01-09', '21:15', USER.timezone).toISOString()
  );
  assert.equal(result.item.scheduling_type, 'fixed');

  const history = state.taskHistory.at(-1);
  assert.equal(history.eventType, 'rescheduled');
  assert.equal(history.actor, 'user');
  assert.equal(history.details.previous.scheduledStart.includes('T18:00'), true);
  assert.equal(history.details.next.scheduledStart.includes('T18:15'), true);
});

test('changing a fixed calendar commitment writes calendar event history', async () => {
  const { plan, state } = makeHarness();

  const result = await plan.editEvent(USER, 'bbbb2222', { title: 'Evening review (moved)' });

  assert.equal(result.event.title, 'Evening review (moved)');

  const history = state.eventHistory.at(-1);
  assert.equal(history.event_type, 'edited');
  assert.equal(history.old_title, 'Evening review');
  assert.equal(history.new_title, 'Evening review (moved)');
  assert.equal(history.details.previous.title, 'Evening review');
  assert.ok(result.undoRef);
});

test('exact start and end times can move an item to another week', async () => {
  const { plan } = makeHarness();

  const result = await plan.saveScheduledChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    date: '2030-01-16',
    start: '20:30',
    end: '21:00',
  });

  assert.equal(
    result.item.scheduled_start.toISOString(),
    zonedWallTimeToUtc('2030-01-16', '20:30', USER.timezone).toISOString()
  );
  assert.equal(
    result.item.scheduled_end.toISOString(),
    zonedWallTimeToUtc('2030-01-16', '21:00', USER.timezone).toISOString()
  );
});

test('an end time before the start time is refused', async () => {
  const { plan } = makeHarness();

  await assert.rejects(
    () =>
      plan.saveScheduledChange(USER, {
        kind: 'task',
        reference: 'aaaa1111',
        date: '2030-01-09',
        start: '21:00',
        end: '20:30',
      }),
    (error) => error.code === 'TIME_ORDER_INVALID'
  );
});

test('a duration change preserves the start time and records the old value', async () => {
  const { plan, state } = makeHarness();

  const result = await plan.editTask(USER, 'aaaa1111', { estimatedMinutes: 90 });

  assert.equal(
    result.task.scheduled_start.toISOString(),
    zonedWallTimeToUtc('2030-01-09', '21:00', USER.timezone).toISOString()
  );
  assert.equal(
    result.task.scheduled_end.getTime() - result.task.scheduled_start.getTime(),
    90 * 60000
  );

  const history = state.taskHistory.at(-1);
  assert.equal(history.details.previous.estimatedMinutes, 30);
  assert.equal(history.details.next.estimatedMinutes, 90);
});

test('an overlap is reported with the exact conflicting item and nothing is written', async () => {
  const { plan, state } = makeHarness();
  const writesBefore = state.scheduleWrites.length;

  await assert.rejects(
    () =>
      plan.saveScheduledChange(USER, {
        kind: 'task',
        reference: 'aaaa1111',
        date: '2030-01-09',
        start: '20:15',
        end: '20:45',
      }),
    (error) => {
      assert.equal(error.code, 'SCHEDULE_CONFLICT');
      assert.equal(error.conflict.title, 'Evening review');
      assert.equal(error.conflict.kind, 'event');
      return true;
    }
  );

  assert.equal(state.scheduleWrites.length, writesBefore);
  assert.equal(state.taskHistory.length, 0);
});

test('an explicitly accepted conflict saves without moving the other item', async () => {
  const { plan, state } = makeHarness();
  const otherBefore = { ...state.events[0] };

  const result = await plan.saveScheduledChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    date: '2030-01-09',
    start: '20:15',
    end: '20:45',
    acceptConflict: true,
  });

  assert.equal(result.acceptedConflict, true);
  assert.equal(state.events[0].starts_at, otherBefore.starts_at);
  assert.equal(state.events[0].ends_at, otherBefore.ends_at);
  assert.equal(state.eventHistory.length, 0);

  const history = state.taskHistory.at(-1);
  assert.equal(history.details.acceptedConflict, true);
});

test('undo restores the previous schedule and keeps the original audit row', async () => {
  const { plan, state } = makeHarness();

  const saved = await plan.saveScheduledChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    date: '2030-01-10',
    start: '07:00',
    end: '07:30',
  });

  const undone = await plan.undoChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    undoRef: saved.undoRef,
  });

  assert.equal(
    undone.item.scheduled_start.toISOString(),
    zonedWallTimeToUtc('2030-01-09', '21:00', USER.timezone).toISOString()
  );
  assert.equal(state.taskHistory.length, 2);
  assert.equal(state.taskHistory.at(-1).eventType, 'undo');
  assert.equal(state.taskHistory[0].eventType, 'rescheduled');
});

test('undo restores an edited title', async () => {
  const { plan } = makeHarness();

  const edited = await plan.editTask(USER, 'aaaa1111', { title: 'Evening Bible study' });
  assert.equal(edited.task.title, 'Evening Bible study');

  const undone = await plan.undoChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    undoRef: edited.undoRef,
  });

  assert.equal(undone.item.title, 'Morning Bible study');
});

test('deleting a commitment is reversible and keeps its history', async () => {
  const { plan, state } = makeHarness();

  const deleted = await plan.deleteEvent(USER, 'bbbb2222');
  assert.ok(state.events[0].deleted_at);

  const undone = await plan.undoChange(USER, {
    kind: 'event',
    reference: 'bbbb2222',
    undoRef: deleted.undoRef,
  });

  assert.equal(undone.item.deleted_at, null);
  assert.equal(state.eventHistory.length, 2);
  assert.equal(state.eventHistory.at(-1).event_type, 'undo');
});

test('manual edits use Africa/Nairobi wall-clock time', async () => {
  const { plan } = makeHarness();

  const preview = await plan.previewScheduleChange(USER, {
    kind: 'task',
    reference: 'aaaa1111',
    date: '2030-06-01',
    start: '20:30',
    end: '21:00',
  });

  assert.equal(
    preview.startsAt.toISOString(),
    zonedWallTimeToUtc('2030-06-01', '20:30', 'Africa/Nairobi').toISOString()
  );
  assert.equal(preview.timeZone, 'Africa/Nairobi');
});

test('the schedule flow asks for start, then end, then confirmation', async () => {
  const { plan } = makeHarness();
  const saves = [];
  const flows = createFlowService({
    sessions: fakeSessions(),
    plans: {
      ...plan,
      async saveScheduledChange(_user, options) {
        saves.push(options);
        return { kind: 'task', item: makeTask(), undoRef: 'aaaa0000', acceptedConflict: false };
      },
    },
  });

  const session = await flows.startSchedule(USER, { item: makeTask() });
  assert.equal(session.step, 'schedule_start');

  const afterStart = await flows.setScheduleStart(USER, '20:30');
  assert.equal(afterStart.step, 'schedule_end');
  assert.equal(afterStart.payload.end, '21:00');

  const afterEnd = await flows.setScheduleEnd(USER, '21:00');
  assert.equal(afterEnd.step, 'schedule_confirm');
  assert.equal(afterEnd.payload.start, '20:30');
  assert.equal(afterEnd.payload.end, '21:00');
  assert.equal(afterEnd.payload.conflict, null);

  const saved = await flows.saveSchedule(USER);
  assert.equal(saved.kind, 'task');
  assert.equal(saves[0].acceptConflict, false);
  assert.equal(saves[0].date, '2030-01-09');
});

test('a duration change that overlaps goes through the same confirmation', async () => {
  const { plan, state } = makeHarness({
    events: [
      makeEvent({
        starts_at: zonedWallTimeToUtc('2030-01-09', '21:30', USER.timezone),
        ends_at: zonedWallTimeToUtc('2030-01-09', '22:00', USER.timezone),
      }),
    ],
  });
  const flows = createFlowService({ sessions: fakeSessions(), plans: plan });

  const preview = await flows.startDurationChange(USER, {
    item: makeTask(),
    minutes: 90,
  });

  assert.equal(preview.step, 'schedule_confirm');
  assert.equal(preview.payload.start, '21:00');
  assert.equal(preview.payload.end, '22:30');
  assert.equal(preview.payload.conflict.title, 'Evening review');

  await assert.rejects(
    () => flows.saveSchedule(USER),
    (error) => error.code === 'SCHEDULE_CONFLICT'
  );

  const saved = await flows.saveSchedule(USER, { acceptConflict: true });
  assert.equal(saved.acceptedConflict, true);
  assert.equal(state.tasks[0].estimated_minutes, 90);
});

test('a conflicting preview is shown before saving and needs explicit acceptance', async () => {
  const { plan } = makeHarness();
  const flows = createFlowService({
    sessions: fakeSessions(),
    plans: {
      ...plan,
      async saveScheduledChange(_user, options) {
        if (!options.acceptConflict) {
          const { AppError } = await import('../src/middleware/error-handler.js');
          throw new AppError('That overlaps "Evening review"', {
            statusCode: 409,
            code: 'SCHEDULE_CONFLICT',
          });
        }
        return {
          kind: 'task',
          item: makeTask(),
          undoRef: 'aaaa0000',
          acceptedConflict: true,
        };
      },
    },
  });

  await flows.startSchedule(USER, { item: makeTask() });
  await flows.setScheduleStart(USER, '20:00');
  const preview = await flows.setScheduleEnd(USER, '20:30');

  assert.equal(preview.step, 'schedule_confirm');
  assert.equal(preview.payload.conflict.title, 'Evening review');

  await assert.rejects(
    () => flows.saveSchedule(USER),
    (error) => error.code === 'SCHEDULE_CONFLICT'
  );

  const accepted = await flows.saveSchedule(USER, { acceptConflict: true });
  assert.equal(accepted.acceptedConflict, true);
});
