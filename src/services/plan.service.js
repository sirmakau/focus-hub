import { transaction } from '../config/database.js';
import { createTaskRepository } from '../repositories/task.repository.js';
import { createCalendarRepository } from '../repositories/calendar.repository.js';
import { createCategoryRepository } from '../repositories/category.repository.js';
import { createEnergyRepository } from '../repositories/energy.repository.js';
import { createTaskService } from './task.service.js';
import {
  findOverlap,
  suggestSlots,
  toLocalIntervals,
  withinWakingHours,
  WAKE_END_MINUTES,
} from './schedule.service.js';
import {
  DEFAULT_TIMEZONE,
  addDays,
  endOfZonedDay,
  formatDateLong,
  formatDateShort,
  formatWeekday,
  formatWeekRange,
  isDateString,
  isTimeString,
  minutesOfDay,
  startOfWeek,
  startOfZonedDay,
  todayInZone,
  weekDates,
  zonedDateOf,
  zonedWallTimeToUtc,
} from '../utils/dates.js';
import { AppError } from '../middleware/error-handler.js';

const DEFAULT_TASK_MINUTES = 60;

function timezoneOf(user) {
  return user.timezone || DEFAULT_TIMEZONE;
}

function durationMinutesOf(task) {
  if (task.estimated_minutes) return task.estimated_minutes;
  if (task.scheduled_start && task.scheduled_end) {
    const diff =
      (new Date(task.scheduled_end).getTime() - new Date(task.scheduled_start).getTime()) /
      60000;
    if (diff > 0) return Math.round(diff);
  }
  return DEFAULT_TASK_MINUTES;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Values captured before and after an edit so Undo can restore exactly. */
export function taskSnapshot(task) {
  return {
    title: task.title,
    description: task.description ?? null,
    priority: task.priority,
    categoryId: task.category_id ?? null,
    schedulingType: task.scheduling_type,
    estimatedMinutes: task.estimated_minutes ?? null,
    deadline: isoOrNull(task.deadline),
    scheduledStart: isoOrNull(task.scheduled_start),
    scheduledEnd: isoOrNull(task.scheduled_end),
  };
}

export function eventSnapshot(event) {
  return {
    title: event.title,
    description: event.description ?? null,
    startsAt: isoOrNull(event.starts_at),
    endsAt: isoOrNull(event.ends_at),
    isFixed: event.is_fixed,
    deletedAt: isoOrNull(event.deleted_at),
  };
}

/**
 * Turn a local date plus wall-clock start/end into real instants, enforcing
 * that the end is later than the start.
 */
function scheduleWindow(date, start, end, timeZone) {
  if (!isDateString(date) || !isTimeString(start) || !isTimeString(end)) {
    throw new AppError('That date or time does not look right', {
      statusCode: 400,
      code: 'SCHEDULE_INVALID',
    });
  }

  const startMinutes = minutesOfDay(zonedWallTimeToUtc(date, start, timeZone), timeZone);
  const endMinutes = minutesOfDay(zonedWallTimeToUtc(date, end, timeZone), timeZone);

  if (endMinutes <= startMinutes) {
    throw new AppError('The end time must be later than the start time.', {
      statusCode: 400,
      code: 'TIME_ORDER_INVALID',
    });
  }

  const startsAt = zonedWallTimeToUtc(date, start, timeZone);
  const endsAt = zonedWallTimeToUtc(date, end, timeZone);

  return { startsAt, endsAt };
}

function overlaps(start, end, otherStart, otherEnd) {
  return start.getTime() < new Date(otherEnd).getTime() &&
    new Date(otherStart).getTime() < end.getTime();
}

function timeLabel(value, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function createPlanService({
  tasks = createTaskRepository(),
  calendars = createCalendarRepository(),
  categories = createCategoryRepository(),
  energies = createEnergyRepository(),
  taskService = createTaskService(),
  runInTransaction = transaction,
} = {}) {
  async function resolveEvent(user, reference, { includeDeleted = false } = {}) {
    const prefix = String(reference ?? '').trim().toLowerCase();

    if (!/^[0-9a-f]{4,36}$/.test(prefix)) {
      throw new AppError('That commitment reference is not valid.', {
        statusCode: 400,
        code: 'EVENT_REFERENCE_INVALID',
      });
    }

    const { ambiguous, event } = await calendars.findByPrefix(null, user.id, prefix, {
      includeDeleted,
    });

    if (ambiguous) {
      throw new AppError('That reference matches more than one commitment.', {
        statusCode: 409,
        code: 'EVENT_REFERENCE_AMBIGUOUS',
      });
    }

    if (!event) {
      throw new AppError('No commitment found for that reference.', {
        statusCode: 404,
        code: 'EVENT_NOT_FOUND',
      });
    }

    return event;
  }

  /**
   * Find the first overlapping commitment or task. Nothing is moved as a
   * side effect: the caller decides whether to ask for confirmation.
   */
  async function findScheduleConflict(
    client,
    user,
    { date, timeZone, startsAt, endsAt, excludeTaskId = null, excludeEventId = null }
  ) {
    const dayTasks = await tasks.findScheduledOnDate(client, user.id, timeZone, date);
    const events = await calendars.findBetween(client, user.id, startsAt, endsAt);

    const candidates = [];

    for (const task of dayTasks) {
      if (!task.scheduled_start || !task.scheduled_end) continue;
      if (task.id === excludeTaskId) continue;
      if (!overlaps(startsAt, endsAt, task.scheduled_start, task.scheduled_end)) continue;
      candidates.push({
        kind: 'task',
        id: task.id,
        title: task.title,
        startsAt: new Date(task.scheduled_start).toISOString(),
        endsAt: new Date(task.scheduled_end).toISOString(),
      });
    }

    for (const event of events) {
      if (event.id === excludeEventId) continue;
      if (!overlaps(startsAt, endsAt, event.starts_at, event.ends_at)) continue;
      candidates.push({
        kind: 'event',
        id: event.id,
        title: event.title,
        startsAt: new Date(event.starts_at).toISOString(),
        endsAt: new Date(event.ends_at).toISOString(),
        isFixed: event.is_fixed,
      });
    }

    candidates.sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );

    return candidates[0] ?? null;
  }

  async function busyIntervals(client, user, date, timeZone, { excludeTaskId } = {}) {
    const dayTasks = await tasks.findScheduledOnDate(client, user.id, timeZone, date);
    const events = await calendars.findForDay(
      client,
      user.id,
      startOfZonedDay(date, timeZone),
      endOfZonedDay(date, timeZone)
    );

    const taskIntervals = toLocalIntervals(
      dayTasks.filter((task) => task.id !== excludeTaskId),
      timeZone,
      { startKey: 'scheduled_start', endKey: 'scheduled_end' }
    ).map((interval) => ({ ...interval, kind: 'task' }));

    const eventIntervals = toLocalIntervals(events, timeZone, {
      startKey: 'starts_at',
      endKey: 'ends_at',
    }).map((interval) => ({ ...interval, kind: 'event' }));

    return { intervals: [...taskIntervals, ...eventIntervals], dayTasks, events };
  }

  function conflictError(conflict, timeZone) {
    const label = conflict.kind === 'event' ? 'commitment' : 'task';
    const start = timeLabel(conflict.startsAt, timeZone);
    const end = timeLabel(conflict.endsAt, timeZone);
    const error = new AppError(
      `That overlaps "${conflict.title}" (${label}, ${start}–${end}).`,
      { statusCode: 409, code: 'SCHEDULE_CONFLICT' }
    );
    error.conflict = conflict;
    return error;
  }

  return {
    /* ---------------------------------------------------------------- weeks */

    async week(user, { offset = 0, now = new Date() } = {}) {
      const timeZone = timezoneOf(user);
      const today = todayInZone(timeZone, now);
      const monday = addDays(startOfWeek(today), offset * 7);
      const rangeStart = startOfZonedDay(monday, timeZone);
      const rangeEnd = startOfZonedDay(addDays(monday, 7), timeZone);

      const rows = await tasks.findScheduledBetween(null, user.id, rangeStart, rangeEnd);

      const counts = new Map();
      for (const task of rows) {
        const date = zonedDateOf(task.scheduled_start, timeZone);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      }

      return {
        monday,
        offset,
        today,
        rangeStart,
        rangeEnd,
        weekLabel: formatWeekRange(monday),
        days: weekDates(monday).map((date) => ({
          date,
          weekday: formatWeekday(date),
          label: formatDateShort(date),
          count: counts.get(date) ?? 0,
          isToday: date === today,
        })),
      };
    },

    /* ----------------------------------------------------------------- days */

    async day(user, date) {
      if (!isDateString(date)) {
        throw new AppError('That date does not look right', {
          statusCode: 400,
          code: 'DATE_INVALID',
        });
      }

      const timeZone = timezoneOf(user);
      const dayTasks = await tasks.findScheduledOnDate(null, user.id, timeZone, date);
      const events = await calendars.findForDay(
        null,
        user.id,
        startOfZonedDay(date, timeZone),
        endOfZonedDay(date, timeZone)
      );
      const unscheduled = await tasks.findUnscheduled(null, user.id);
      const energy = await energies.findLatest(null, user.id);

      return {
        date,
        longLabel: formatDateLong(date),
        weekday: formatWeekday(date),
        tasks: dayTasks,
        events,
        unscheduled,
        energy,
        timeZone,
      };
    },

    async taskCard(user, reference) {
      const task = await taskService.getTask(user, reference);
      const list = await categories.listForUser(null, user.id);
      const category = list.find((item) => item.id === task.category_id) ?? null;
      const history = await tasks.findHistory(null, task.id, user.id, 5);

      return { task, category, history, timeZone: timezoneOf(user) };
    },

    async eventCard(user, reference) {
      const event = await resolveEvent(user, reference);
      const history = await calendars.findHistory(null, event.id, user.id, 5);

      return { event, history, timeZone: timezoneOf(user) };
    },

    async getEvent(user, reference) {
      return resolveEvent(user, reference);
    },

    /* ------------------------------------------------------------ listings */

    async allTasks(user, page = 0, perPage = 8) {
      const total = await tasks.countOpen(null, user.id);
      const pages = Math.max(1, Math.ceil(total / perPage));
      const safePage = Math.min(Math.max(0, page), pages - 1);
      const rows = await tasks.findOpenPage(null, user.id, {
        limit: perPage,
        offset: safePage * perPage,
      });

      return { tasks: rows, page: safePage, pages, total, timeZone: timezoneOf(user) };
    },

    async unscheduled(user) {
      const rows = await tasks.findUnscheduled(null, user.id);
      return { tasks: rows, timeZone: timezoneOf(user) };
    },

    async listCategories(user) {
      const existing = await categories.listForUser(null, user.id);
      if (existing.length > 0) return existing;

      await categories.ensureDefaults(null, user.id);
      return categories.listForUser(null, user.id);
    },

    /* ------------------------------------------------------------- writing */

    async createTask(user, input) {
      return taskService.createTask(user, input);
    },

    async completeTask(user, reference) {
      return taskService.completeTask(user, reference);
    },

    async cancelTask(user, reference) {
      return taskService.cancelTask(user, reference);
    },

    /**
     * Edit a task's fields. A duration change keeps the start time and moves
     * the end, so it is checked for conflicts like any other schedule change.
     * Fixed tasks are edited normally: fixed protects them from automation,
     * not from their owner.
     */
    async editTask(user, reference, fields, { reason = 'Edited by user' } = {}) {
      return runInTransaction(async (client) => {
        const task = await taskService.getTask(user, reference);
        const timeZone = timezoneOf(user);
        let scheduledEnd = task.scheduled_end;

        if (fields.estimatedMinutes && task.scheduled_start) {
          scheduledEnd = new Date(
            new Date(task.scheduled_start).getTime() + fields.estimatedMinutes * 60000
          );

          const conflict = await findScheduleConflict(client, user, {
            date: zonedDateOf(task.scheduled_start, timeZone),
            timeZone,
            startsAt: new Date(task.scheduled_start),
            endsAt: scheduledEnd,
            excludeTaskId: task.id,
          });

          if (conflict) throw conflictError(conflict, timeZone);
        }

        let updated = await tasks.updateFields(client, task.id, user.id, fields);

        if (fields.estimatedMinutes && task.scheduled_start) {
          updated = await tasks.updateSchedule(client, task.id, user.id, {
            scheduledStart: task.scheduled_start,
            scheduledEnd,
          });
        }

        const historyId = await tasks.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: fields.priority ? 'priority_changed' : 'edited',
          oldStatus: task.status,
          newStatus: task.status,
          oldScheduledStart: task.scheduled_start,
          newScheduledStart: updated.scheduled_start,
          oldScheduledEnd: task.scheduled_end,
          newScheduledEnd: updated.scheduled_end,
          details: {
            previous: taskSnapshot(task),
            next: taskSnapshot({ ...task, ...updated, ...fields }),
            changed: Object.keys(fields),
          },
          reason,
          actor: 'user',
        });

        return { task: updated, undoRef: historyId ? historyId.slice(0, 8) : null };
      });
    },

    /* -------------------------------------------------- manual scheduling */

    /** Preview an exact date/start/end change without writing anything. */
    async previewScheduleChange(user, { kind = 'task', reference, date, start, end }) {
      const timeZone = timezoneOf(user);
      const { startsAt, endsAt } = scheduleWindow(date, start, end, timeZone);
      const item =
        kind === 'event'
          ? await resolveEvent(user, reference)
          : await taskService.getTask(user, reference);

      const conflict = await findScheduleConflict(null, user, {
        date,
        timeZone,
        startsAt,
        endsAt,
        excludeTaskId: kind === 'task' ? item.id : null,
        excludeEventId: kind === 'event' ? item.id : null,
      });

      return {
        kind,
        item,
        date,
        start,
        end,
        startsAt,
        endsAt,
        conflict,
        timeZone,
      };
    },

    /**
     * Save an exact user-chosen schedule. A conflict stops the save unless the
     * user explicitly accepted it; no other item is ever moved to make room.
     */
    async saveScheduledChange(
      user,
      { kind = 'task', reference, date, start, end, estimatedMinutes = null,
        acceptConflict = false, reason = 'Manually rescheduled by user' }
    ) {
      const timeZone = timezoneOf(user);
      const { startsAt, endsAt } = scheduleWindow(date, start, end, timeZone);

      return runInTransaction(async (client) => {
        const item =
          kind === 'event'
            ? await resolveEvent(user, reference)
            : await taskService.getTask(user, reference);

        const conflict = await findScheduleConflict(client, user, {
          date,
          timeZone,
          startsAt,
          endsAt,
          excludeTaskId: kind === 'task' ? item.id : null,
          excludeEventId: kind === 'event' ? item.id : null,
        });

        if (conflict && !acceptConflict) {
          throw conflictError(conflict, timeZone);
        }

        let updated;
        let historyId;

        if (kind === 'event') {
          updated = await calendars.updateEvent(client, item.id, user.id, {
            startsAt,
            endsAt,
          });

          historyId = await calendars.insertHistory(client, {
            eventId: item.id,
            userId: user.id,
            eventType: 'rescheduled',
            oldStartsAt: item.starts_at,
            newStartsAt: startsAt,
            oldEndsAt: item.ends_at,
            newEndsAt: endsAt,
            details: {
              previous: eventSnapshot(item),
              next: eventSnapshot(updated),
              changed: ['starts_at', 'ends_at'],
              acceptedConflict: Boolean(conflict),
            },
            reason,
            actor: 'user',
          });
        } else {
          updated = await tasks.updateSchedule(client, item.id, user.id, {
            scheduledStart: startsAt,
            scheduledEnd: endsAt,
          });

          if (estimatedMinutes) {
            updated = await tasks.updateFields(client, item.id, user.id, {
              estimatedMinutes,
            });
          }

          historyId = await tasks.insertHistory(client, {
            taskId: item.id,
            userId: user.id,
            eventType: 'rescheduled',
            oldScheduledStart: item.scheduled_start,
            newScheduledStart: startsAt,
            oldScheduledEnd: item.scheduled_end,
            newScheduledEnd: endsAt,
            details: {
              previous: taskSnapshot(item),
              next: taskSnapshot(updated),
              changed: ['scheduled_start', 'scheduled_end'],
              acceptedConflict: Boolean(conflict),
            },
            reason,
            actor: 'user',
          });
        }

        return {
          kind,
          item: updated,
          undoRef: historyId ? historyId.slice(0, 8) : null,
          acceptedConflict: Boolean(conflict),
          conflict,
        };
      });
    },

    /** Edit a commitment's own fields (title, notes, fixed flag). */
    async editEvent(user, reference, fields, { reason = 'Edited by user' } = {}) {
      return runInTransaction(async (client) => {
        const event = await resolveEvent(user, reference);
        const updated = await calendars.updateEvent(client, event.id, user.id, fields);

        const historyId = await calendars.insertHistory(client, {
          eventId: event.id,
          userId: user.id,
          eventType: 'edited',
          oldTitle: event.title,
          newTitle: updated.title,
          oldDescription: event.description,
          newDescription: updated.description,
          oldStartsAt: event.starts_at,
          newStartsAt: updated.starts_at,
          oldEndsAt: event.ends_at,
          newEndsAt: updated.ends_at,
          oldIsFixed: event.is_fixed,
          newIsFixed: updated.is_fixed,
          details: {
            previous: eventSnapshot(event),
            next: eventSnapshot(updated),
            changed: Object.keys(fields),
          },
          reason,
          actor: 'user',
        });

        return { event: updated, undoRef: historyId ? historyId.slice(0, 8) : null };
      });
    },

    /** Soft-delete a commitment; its history and Undo stay intact. */
    async deleteEvent(user, reference, { reason = 'Deleted by user' } = {}) {
      return runInTransaction(async (client) => {
        const event = await resolveEvent(user, reference);
        const deleted = await calendars.softDelete(client, event.id, user.id);

        const historyId = await calendars.insertHistory(client, {
          eventId: event.id,
          userId: user.id,
          eventType: 'deleted',
          oldDeletedAt: event.deleted_at ?? null,
          newDeletedAt: deleted.deleted_at,
          details: {
            previous: eventSnapshot(event),
            next: eventSnapshot(deleted),
          },
          reason,
          actor: 'user',
        });

        return { event: deleted, undoRef: historyId ? historyId.slice(0, 8) : null };
      });
    },

    /**
     * Undo one recorded change by restoring the previous snapshot. A new
     * history row records the reversal; the original audit row is preserved.
     */
    async undoChange(user, { kind = 'task', reference, undoRef }) {
      return runInTransaction(async (client) => {
        if (kind === 'event') {
          const event = await resolveEvent(user, reference, { includeDeleted: true });
          const { ambiguous, entry } = await calendars.findHistoryByPrefix(
            client,
            user.id,
            event.id,
            undoRef
          );

          if (ambiguous || !entry?.details?.previous) {
            throw new AppError('That change can no longer be undone.', {
              statusCode: 404,
              code: 'UNDO_NOT_FOUND',
            });
          }

          const previous = entry.details.previous;
          const restored = await calendars.restore(client, event.id, user.id, {
            title: previous.title,
            description: previous.description,
            startsAt: previous.startsAt ? new Date(previous.startsAt) : undefined,
            endsAt: previous.endsAt ? new Date(previous.endsAt) : undefined,
            isFixed: previous.isFixed,
          });

          const historyId = await calendars.insertHistory(client, {
            eventId: event.id,
            userId: user.id,
            eventType: 'undo',
            oldTitle: event.title,
            newTitle: restored.title,
            oldStartsAt: event.starts_at,
            newStartsAt: restored.starts_at,
            oldEndsAt: event.ends_at,
            newEndsAt: restored.ends_at,
            oldIsFixed: event.is_fixed,
            newIsFixed: restored.is_fixed,
            oldDeletedAt: event.deleted_at ?? null,
            newDeletedAt: restored.deleted_at ?? null,
            details: {
              previous: eventSnapshot(event),
              next: eventSnapshot(restored),
              undoneHistoryId: entry.id,
            },
            reason: 'Undo by user',
            actor: 'user',
          });

          return { kind, item: restored, undoRef: historyId ? historyId.slice(0, 8) : null };
        }

        const task = await taskService.getTask(user, reference);
        const { ambiguous, entry } = await tasks.findHistoryByPrefix(
          client,
          user.id,
          task.id,
          undoRef
        );

        if (ambiguous || !entry?.details?.previous) {
          throw new AppError('That change can no longer be undone.', {
            statusCode: 404,
            code: 'UNDO_NOT_FOUND',
          });
        }

        const previous = entry.details.previous;
        let restored = await tasks.updateFields(client, task.id, user.id, {
          title: previous.title,
          description: previous.description,
          priority: previous.priority,
          categoryId: previous.categoryId,
          schedulingType: previous.schedulingType,
          estimatedMinutes: previous.estimatedMinutes,
          deadline: previous.deadline ? new Date(previous.deadline) : null,
        });

        restored = await tasks.updateSchedule(client, task.id, user.id, {
          scheduledStart: previous.scheduledStart ? new Date(previous.scheduledStart) : null,
          scheduledEnd: previous.scheduledEnd ? new Date(previous.scheduledEnd) : null,
        });

        const historyId = await tasks.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: 'undo',
          oldStatus: task.status,
          newStatus: restored.status,
          oldScheduledStart: task.scheduled_start,
          newScheduledStart: restored.scheduled_start,
          oldScheduledEnd: task.scheduled_end,
          newScheduledEnd: restored.scheduled_end,
          details: {
            previous: taskSnapshot(task),
            next: taskSnapshot(restored),
            undoneHistoryId: entry.id,
          },
          reason: 'Undo by user',
          actor: 'user',
        });

        return { kind, item: restored, undoRef: historyId ? historyId.slice(0, 8) : null };
      });
    },

    async slots(user, { date, durationMinutes, excludeTaskId = null }) {
      if (!isDateString(date)) {
        throw new AppError('That date does not look right', {
          statusCode: 400,
          code: 'DATE_INVALID',
        });
      }

      const timeZone = timezoneOf(user);
      const { intervals } = await busyIntervals(null, user, date, timeZone, {
        excludeTaskId,
      });
      const energy = await energies.findLatest(null, user.id);

      const result = suggestSlots({
        durationMinutes,
        busy: intervals,
        energyLevel: energy?.energy_level ?? null,
      });

      return { date, ...result, energy, timeZone };
    },

    /**
     * Validate a proposed slot against rest hours, deadlines, other tasks and
     * calendar commitments. Throws an AppError with a user-facing reason.
     */
    async assertSlotAvailable(
      user,
      { date, time, durationMinutes, excludeTaskId = null, deadline = null }
    ) {
      if (!isDateString(date) || !isTimeString(time)) {
        throw new AppError('That date or time does not look right', {
          statusCode: 400,
          code: 'SCHEDULE_INVALID',
        });
      }

      const timeZone = timezoneOf(user);
      const duration = Number(durationMinutes) || DEFAULT_TASK_MINUTES;
      const start = zonedWallTimeToUtc(date, time, timeZone);
      const end = new Date(start.getTime() + duration * 60000);

      if (start.getTime() < Date.now()) {
        throw new AppError('That time is in the past. Choose a later slot.', {
          statusCode: 409,
          code: 'SCHEDULE_IN_PAST',
        });
      }

      const startMinutes = minutesOfDay(start, timeZone);

      if (!withinWakingHours(startMinutes, duration)) {
        throw new AppError(
          `I protect your rest: tasks stay between 06:00 and ${Math.floor(WAKE_END_MINUTES / 60)}:00.`,
          { statusCode: 409, code: 'OUTSIDE_WAKING_HOURS' }
        );
      }

      if (deadline && end.getTime() > new Date(deadline).getTime()) {
        throw new AppError(
          'That would finish after the task deadline. Choose an earlier slot.',
          { statusCode: 409, code: 'DEADLINE_CONFLICT' }
        );
      }

      const { intervals } = await busyIntervals(null, user, date, timeZone, {
        excludeTaskId,
      });

      const conflict = findOverlap(startMinutes, startMinutes + duration, intervals);
      if (conflict) {
        const label = conflict.kind === 'event' ? 'commitment' : 'task';
        throw new AppError(
          `That overlaps "${conflict.title}" (${label}). Pick another slot.`,
          { statusCode: 409, code: 'SCHEDULE_CONFLICT' }
        );
      }

      return { start, end, timeZone };
    },

    /**
     * Move a task to a specific local date and time.
     * User-initiated, so fixed commitments may be moved explicitly, but the
     * change is always recorded with the old and new schedule.
     */
    async reschedule(
      user,
      { reference, date, time, reason = 'Rescheduled by user', actor = 'user' }
    ) {
      if (!isDateString(date) || !isTimeString(time)) {
        throw new AppError('That date or time does not look right', {
          statusCode: 400,
          code: 'SCHEDULE_INVALID',
        });
      }

      return runInTransaction(async (client) => {
        const task = await taskService.getTask(user, reference);
        const duration = durationMinutesOf(task);

        const { start, end } = await this.assertSlotAvailable(user, {
          date,
          time,
          durationMinutes: duration,
          excludeTaskId: task.id,
          deadline: task.deadline ?? null,
        });

        const updated = await tasks.updateSchedule(client, task.id, user.id, {
          scheduledStart: start,
          scheduledEnd: end,
        });

        await tasks.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: 'rescheduled',
          oldScheduledStart: task.scheduled_start,
          newScheduledStart: start,
          oldScheduledEnd: task.scheduled_end,
          newScheduledEnd: end,
          reason,
          actor,
        });

        return updated;
      });
    },

    /**
     * Automatic rescheduling is only allowed for flexible tasks. A fixed
     * commitment is refused with a reason the bot can show the user.
     */
    async autoReschedule(user, { reference, date, time, reason = 'Automatically adjusted' }) {
      const task = await taskService.getTask(user, reference);

      if (task.scheduling_type === 'fixed') {
        throw new AppError(
          'That is a fixed commitment, so I will not move it automatically.',
          { statusCode: 409, code: 'FIXED_COMMITMENT_PROTECTED' }
        );
      }

      if (task.auto_reschedule === false) {
        throw new AppError('You turned off automatic rescheduling for that task.', {
          statusCode: 409,
          code: 'AUTO_RESCHEDULE_DISABLED',
        });
      }

      return this.reschedule(user, {
        reference,
        date,
        time,
        reason,
        actor: 'system',
      });
    },

    /* -------------------------------------------------------------- review */

    async review(user, { offset = 0, now = new Date() } = {}) {
      const week = await this.week(user, { offset, now });
      const rows = await tasks.findScheduledBetween(
        null,
        user.id,
        week.rangeStart,
        week.rangeEnd
      );
      const unscheduled = await tasks.findUnscheduled(null, user.id);

      const byDate = new Map();
      const totals = { total: 0, completed: 0, open: 0 };

      for (const task of rows) {
        const date = zonedDateOf(task.scheduled_start, timezoneOf(user));
        const entry = byDate.get(date) ?? { total: 0, completed: 0 };
        entry.total += 1;
        totals.total += 1;

        if (task.status === 'completed') {
          entry.completed += 1;
          totals.completed += 1;
        } else {
          totals.open += 1;
        }

        byDate.set(date, entry);
      }

      return {
        week,
        totals,
        unscheduledCount: unscheduled.length,
        days: week.days.map((day) => ({
          ...day,
          ...(byDate.get(day.date) ?? { total: 0, completed: 0 }),
        })),
      };
    },
  };
}
