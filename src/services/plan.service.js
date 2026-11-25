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

export function createPlanService({
  tasks = createTaskRepository(),
  calendars = createCalendarRepository(),
  categories = createCategoryRepository(),
  energies = createEnergyRepository(),
  taskService = createTaskService(),
  runInTransaction = transaction,
} = {}) {
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

    async editTask(user, reference, fields, { reason = 'Edited by user' } = {}) {
      return runInTransaction(async (client) => {
        const task = await taskService.getTask(user, reference);
        let updated = await tasks.updateFields(client, task.id, user.id, fields);

        // Keep the scheduled end consistent with a changed duration.
        if (fields.estimatedMinutes && task.scheduled_start) {
          const end = new Date(
            new Date(task.scheduled_start).getTime() + fields.estimatedMinutes * 60000
          );
          updated = await tasks.updateSchedule(client, task.id, user.id, {
            scheduledStart: task.scheduled_start,
            scheduledEnd: end,
          });
        }

        await tasks.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: fields.priority ? 'priority_changed' : 'edited',
          oldStatus: task.status,
          newStatus: task.status,
          reason,
          actor: 'user',
        });

        return updated;
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
