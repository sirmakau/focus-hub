import { createSessionService } from './session.service.js';
import { createPlanService } from './plan.service.js';
import { AppError } from '../middleware/error-handler.js';
import {
  endOfZonedDay,
  formatDateLong,
  hhmmToMinutes,
  isDateString,
  isTimeString,
  minutesOfDay,
  minutesToHHMM,
  todayInZone,
  zonedDateOf,
  zonedWallTimeToUtc,
} from '../utils/dates.js';

export const ADD_FLOW = 'add_task';
export const EDIT_FLOW = 'edit_task';
export const SCHEDULE_FLOW = 'edit_schedule';

export const FLOW_STEPS = [
  'day',
  'title',
  'type',
  'category',
  'priority',
  'duration',
  'time',
  'deadline',
  'confirm',
  'custom_date',
  'custom_duration',
  'custom_time',
  'custom_deadline',
  'edit_menu',
  'edit_title',
  'edit_description',
  'edit_duration',
  'schedule_date',
  'schedule_start',
  'schedule_end',
  'schedule_confirm',
];

const NEXT_STEP = {
  day: 'title',
  title: 'type',
  type: 'category',
  category: 'priority',
  priority: 'duration',
  duration: 'time',
  time: 'deadline',
  deadline: 'confirm',
  confirm: 'confirm',
  custom_date: 'title',
  custom_duration: 'time',
  custom_time: 'deadline',
  custom_deadline: 'confirm',
  edit_title: 'edit_menu',
};

const PREVIOUS_STEP = {
  title: 'day',
  type: 'title',
  category: 'type',
  priority: 'category',
  duration: 'priority',
  time: 'duration',
  deadline: 'time',
  confirm: 'deadline',
  custom_date: 'day',
  custom_duration: 'duration',
  custom_time: 'time',
  custom_deadline: 'deadline',
  edit_title: 'edit_menu',
  edit_description: 'edit_menu',
  edit_duration: 'edit_menu',
  schedule_start: 'schedule_date',
  schedule_end: 'schedule_start',
  schedule_confirm: 'schedule_end',
};

const DURATION_MINUTES = [15, 30, 45, 60, 120];
const TYPES = new Set(['fixed', 'flexible']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

const MAX_TITLE_LENGTH = 200;
const MAX_DURATION_MINUTES = 8 * 60;

function requireStep(session, allowed) {
  if (!allowed.includes(session.step)) {
    throw new AppError('That button no longer applies to this step.', {
      statusCode: 409,
      code: 'FLOW_STEP_MISMATCH',
    });
  }
}

function positiveMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
    throw new AppError(`Choose a duration between 1 and ${MAX_DURATION_MINUTES} minutes.`, {
      statusCode: 400,
      code: 'DURATION_INVALID',
    });
  }
  return minutes;
}

export function createFlowService({
  sessions = createSessionService(),
  plans = createPlanService(),
} = {}) {
  async function advance(user, session, patch = {}, { step } = {}) {
    const payload = { ...session.payload, ...patch };
    const nextStep = step ?? NEXT_STEP[session.step];

    return sessions.update(user, { step: nextStep, payload });
  }

  async function scheduleSession(user) {
    const session = await sessions.get(user);
    if (!session || session.flow !== SCHEDULE_FLOW) {
      throw new AppError('That change has expired. Open the task again.', {
        statusCode: 410,
        code: 'FLOW_EXPIRED',
      });
    }
    return session;
  }

  return {
    async getState(user) {
      return sessions.get(user);
    },

    async clear(user) {
      await sessions.clear(user);
    },

    /* ------------------------------------------------------------- add flow */

    async startAdd(user, { date = null } = {}) {
      const payload = { date: null, weekOffset: 0 };
      let step = 'day';

      if (isDateString(date)) {
        payload.date = date;
        step = 'title';
      }

      return sessions.start(user, {
        flow: ADD_FLOW,
        step,
        payload,
        replace: true,
      });
    },

    /** Step back one question without losing the answers already given. */
    async back(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, {
        step: PREVIOUS_STEP[session.step] ?? 'day',
        payload: session.payload,
      });
    },

    /** Return to the first question, keeping all answers for editing. */
    async reopen(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'day', payload: session.payload });
    },

    async setDay(user, date) {
      if (!isDateString(date)) {
        throw new AppError('That date does not look right. Use DD/MM or YYYY-MM-DD.', {
          statusCode: 400,
          code: 'DATE_INVALID',
        });
      }

      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, { date });
    },

    async setTitle(user, title) {
      const trimmed = String(title ?? '').trim();

      if (!trimmed) {
        throw new AppError('A task needs a name. Send it as a message.', {
          statusCode: 400,
          code: 'TASK_TITLE_REQUIRED',
        });
      }

      if (trimmed.length > MAX_TITLE_LENGTH) {
        throw new AppError(`Task names are limited to ${MAX_TITLE_LENGTH} characters.`, {
          statusCode: 400,
          code: 'TASK_TITLE_TOO_LONG',
        });
      }

      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, { title: trimmed });
    },

    async setType(user, type) {
      if (!TYPES.has(type)) {
        throw new AppError('Choose fixed or flexible.', {
          statusCode: 400,
          code: 'SCHEDULING_TYPE_INVALID',
        });
      }

      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, { schedulingType: type });
    },

    async setCategory(user, category) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, {
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
      });
    },

    async setPriority(user, priority) {
      if (!PRIORITIES.has(priority)) {
        throw new AppError('Choose a priority.', {
          statusCode: 400,
          code: 'PRIORITY_INVALID',
        });
      }

      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, { priority });
    },

    async setDuration(user, minutes) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return advance(user, session, { durationMinutes: positiveMinutes(minutes) });
    },

    async requestCustomDate(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'custom_date', payload: session.payload });
    },

    async requestCustomDuration(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'custom_duration', payload: session.payload });
    },

    /**
     * @param {string | null} time `HH:MM`, or null for "leave unscheduled"
     */
    async setTime(user, time) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      if (time !== null && !isTimeString(time)) {
        throw new AppError('Use 24-hour time like 09:30.', {
          statusCode: 400,
          code: 'TIME_INVALID',
        });
      }

      return advance(user, session, {
        time,
        scheduledStartIso: null,
      });
    },

    async requestCustomTime(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'custom_time', payload: session.payload });
    },

    async setDeadline(user, date) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      if (date === null) {
        return advance(user, session, { deadline: null });
      }

      if (!isDateString(date)) {
        throw new AppError('Use DD/MM or YYYY-MM-DD for the deadline.', {
          statusCode: 400,
          code: 'DATE_INVALID',
        });
      }

      const timeZone = user.timezone || 'Africa/Nairobi';
      const deadline = endOfZonedDay(date, timeZone);

      return advance(user, session, { deadline: deadline.toISOString(), deadlineDate: date });
    },

    async requestCustomDeadline(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'custom_deadline', payload: session.payload });
    },

    /* ------------------------------------------------------------- saving */

    async save(user) {
      const session = await sessions.get(user);

      if (!session) throw expired();

      const payload = session.payload;

      if (payload.savedTaskId) {
        const existing = await plans.taskCard(user, payload.savedTaskId.slice(0, 8));
        return { task: existing.task, duplicate: true };
      }

      if (session.step === 'saving') {
        throw new AppError('That task is already being saved.', {
          statusCode: 409,
          code: 'FLOW_SAVING',
        });
      }

      requireStep(session, ['confirm']);

      if (!payload.date || !isDateString(payload.date)) {
        throw new AppError('Pick a day before saving.', {
          statusCode: 400,
          code: 'FLOW_DAY_MISSING',
        });
      }

      if (!payload.title) {
        throw new AppError('A task needs a name before saving.', {
          statusCode: 400,
          code: 'TASK_TITLE_REQUIRED',
        });
      }

      const durationMinutes = payload.durationMinutes ?? 30;
      const timeZone = user.timezone || 'Africa/Nairobi';
      let scheduledStart = null;
      let scheduledEnd = null;

      if (payload.time) {
        await plans.assertSlotAvailable(user, {
          date: payload.date,
          time: payload.time,
          durationMinutes,
          deadline: payload.deadline ?? null,
        });

        scheduledStart = zonedWallTimeToUtc(payload.date, payload.time, timeZone);
        scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60000);
      }

      // Persist "saving" before the insert so a repeated button press cannot
      // create a second task.
      await sessions.update(user, { step: 'saving', payload });

      const task = await plans.createTask(user, {
        title: payload.title,
        description: payload.description ?? undefined,
        categoryId: payload.categoryId ?? null,
        priority: payload.priority ?? 'normal',
        schedulingType: payload.schedulingType ?? 'flexible',
        estimatedMinutes: durationMinutes,
        scheduledStart,
        scheduledEnd,
        deadline: payload.deadline ? new Date(payload.deadline) : null,
        reason: 'Created with the guided planner',
      });

      await sessions.update(user, {
        step: 'saved',
        payload: { ...payload, savedTaskId: task.id },
      });

      return { task, duplicate: false };
    },

    /* ------------------------------------------------------------ edit flow */

    async startEdit(user, item, { kind = 'task' } = {}) {
      return sessions.start(user, {
        flow: EDIT_FLOW,
        step: 'edit_menu',
        payload: { kind, taskRef: item.id.slice(0, 8), title: item.title },
        replace: true,
      });
    },

    async requestEditTitle(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'edit_title', payload: session.payload });
    },

    async requestEditDescription(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'edit_description', payload: session.payload });
    },

    async requestEditDuration(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'edit_duration', payload: session.payload });
    },

    async applyEdit(user, field, value) {
      const session = await sessions.get(user);

      if (!session || session.flow !== EDIT_FLOW) {
        throw new AppError('That form has expired. Open the task again.', {
          statusCode: 410,
          code: 'FLOW_EXPIRED',
        });
      }

      const kind = session.payload.kind ?? 'task';
      const fields = {};

      if (field === 'title') {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) {
          throw new AppError('A task needs a name.', {
            statusCode: 400,
            code: 'TASK_TITLE_REQUIRED',
          });
        }
        if (trimmed.length > MAX_TITLE_LENGTH) {
          throw new AppError(`Task names are limited to ${MAX_TITLE_LENGTH} characters.`, {
            statusCode: 400,
            code: 'TASK_TITLE_TOO_LONG',
          });
        }
        fields.title = trimmed;
      } else if (field === 'priority') {
        if (!PRIORITIES.has(value)) {
          throw new AppError('Choose a priority.', {
            statusCode: 400,
            code: 'PRIORITY_INVALID',
          });
        }
        fields.priority = value;
      } else if (field === 'category') {
        fields.categoryId = value?.id ?? null;
      } else if (field === 'duration') {
        fields.estimatedMinutes = positiveMinutes(value);
      } else if (field === 'description') {
        const trimmed = String(value ?? '').trim();
        fields.description = trimmed.length > 0 ? trimmed : null;
      } else if (field === 'type') {
        if (!TYPES.has(value)) {
          throw new AppError('Choose fixed or flexible.', {
            statusCode: 400,
            code: 'SCHEDULING_TYPE_INVALID',
          });
        }
        fields.schedulingType = value;
      } else {
        throw new AppError('That edit is not supported.', {
          statusCode: 400,
          code: 'EDIT_FIELD_INVALID',
        });
      }

      if (kind === 'event') {
        if (!['title', 'description', 'type'].includes(field)) {
          throw new AppError('That field does not apply to a calendar commitment.', {
            statusCode: 400,
            code: 'EDIT_FIELD_INVALID',
          });
        }

        const eventFields = { title: fields.title, description: fields.description };
        if (field === 'type') eventFields.isFixed = value === 'fixed';

        const result = await plans.editEvent(user, session.payload.taskRef, eventFields, {
          reason: `Edited ${field} from the planner`,
        });

        await sessions.clear(user);

        return { kind, item: result.event, field, undoRef: result.undoRef ?? null };
      }

      const result = await plans.editTask(user, session.payload.taskRef, fields, {
        reason: `Edited ${field} from the planner`,
      });

      await sessions.clear(user);

      return { kind, item: result.task, field, undoRef: result.undoRef ?? null };
    },

    /* ------------------------------------------------- exact schedule flow */

    /**
     * Start editing the exact date and start/end times of a task or a calendar
     * commitment. Nothing is written until the confirmation step.
     */
    async startSchedule(user, { kind = 'task', item }) {
      const timeZone = user.timezone || 'Africa/Nairobi';
      const startValue = kind === 'event' ? item.starts_at : item.scheduled_start;
      const endValue = kind === 'event' ? item.ends_at : item.scheduled_end;

      const durationMinutes =
        startValue && endValue
          ? Math.round(
              (new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000
            )
          : item.estimated_minutes ?? 30;

      const date = startValue
        ? zonedDateOf(startValue, timeZone)
        : todayInZone(timeZone);
      const start = startValue
        ? minutesToHHMM(minutesOfDay(startValue, timeZone))
        : null;
      const end =
        startValue && endValue
          ? minutesToHHMM(minutesOfDay(endValue, timeZone))
          : null;

      return sessions.start(user, {
        flow: SCHEDULE_FLOW,
        step: start ? 'schedule_start' : 'schedule_date',
        payload: {
          kind,
          ref: item.id.slice(0, 8),
          title: item.title,
          date,
          start,
          end,
          durationMinutes: durationMinutes > 0 ? durationMinutes : 30,
          originalDate: date,
          originalStart: start,
          originalEnd: end,
          isFixed:
            kind === 'event'
              ? Boolean(item.is_fixed)
              : item.scheduling_type === 'fixed',
          conflict: null,
        },
        replace: true,
      });
    },

    async requestScheduleDate(user) {
      const session = await scheduleSession(user);
      return sessions.update(user, { step: 'schedule_date', payload: session.payload });
    },

    async setScheduleDate(user, date) {
      if (!isDateString(date)) {
        throw new AppError('Use DD/MM or YYYY-MM-DD for the new date.', {
          statusCode: 400,
          code: 'DATE_INVALID',
        });
      }

      const session = await scheduleSession(user);

      return sessions.update(user, {
        step: 'schedule_start',
        payload: { ...session.payload, date },
      });
    },

    async requestScheduleStart(user) {
      const session = await scheduleSession(user);
      return sessions.update(user, { step: 'schedule_start', payload: session.payload });
    },

    /** Keep the existing start time and move on to the end time. */
    async keepScheduleStart(user) {
      const session = await scheduleSession(user);

      if (!session.payload.start) {
        throw new AppError('Send the new start time first.', {
          statusCode: 400,
          code: 'TIME_REQUIRED',
        });
      }

      return sessions.update(user, { step: 'schedule_end', payload: session.payload });
    },

    async setScheduleStart(user, time) {
      const session = await scheduleSession(user);

      if (!isTimeString(time)) {
        throw new AppError('Use 24-hour time like 20:30.', {
          statusCode: 400,
          code: 'TIME_INVALID',
        });
      }

      const duration = session.payload.durationMinutes ?? 30;
      const startMinutes = hhmmToMinutes(time);

      if (startMinutes + duration > 24 * 60) {
        throw new AppError('That start plus the duration runs past midnight.', {
          statusCode: 400,
          code: 'TIME_ORDER_INVALID',
        });
      }

      const end = minutesToHHMM(startMinutes + duration);

      return sessions.update(user, {
        step: 'schedule_end',
        payload: { ...session.payload, start: time, end },
      });
    },

    async requestScheduleEnd(user) {
      const session = await scheduleSession(user);
      return sessions.update(user, { step: 'schedule_end', payload: session.payload });
    },

    async setScheduleEnd(user, time) {
      const session = await scheduleSession(user);

      if (!isTimeString(time)) {
        throw new AppError('Use 24-hour time like 21:00.', {
          statusCode: 400,
          code: 'TIME_INVALID',
        });
      }

      const startMinutes = hhmmToMinutes(session.payload.start);
      const endMinutes = hhmmToMinutes(time);

      if (endMinutes <= startMinutes) {
        throw new AppError('The end time must be later than the start time.', {
          statusCode: 400,
          code: 'TIME_ORDER_INVALID',
        });
      }

      return this.previewSchedule(user, {
        ...session.payload,
        end: time,
        durationMinutes: endMinutes - startMinutes,
      });
    },

    /** Keep the proposed end time and move to the confirmation step. */
    async keepScheduleEnd(user) {
      const session = await scheduleSession(user);
      return this.previewSchedule(user, session.payload);
    },

    async previewSchedule(user, payload) {
      if (!payload.start || !payload.end) {
        throw new AppError('Both a start and an end time are needed.', {
          statusCode: 400,
          code: 'TIME_REQUIRED',
        });
      }

      const preview = await plans.previewScheduleChange(user, {
        kind: payload.kind,
        reference: payload.ref,
        date: payload.date,
        start: payload.start,
        end: payload.end,
      });

      const session = await scheduleSession(user);

      return sessions.update(user, {
        step: 'schedule_confirm',
        payload: {
          ...session.payload,
          kind: payload.kind,
          ref: payload.ref,
          title: payload.title,
          date: payload.date,
          start: payload.start,
          end: payload.end,
          durationMinutes:
            hhmmToMinutes(payload.end) - hhmmToMinutes(payload.start),
          conflict: preview.conflict
            ? {
                kind: preview.conflict.kind,
                title: preview.conflict.title,
                startsAt: preview.conflict.startsAt,
                endsAt: preview.conflict.endsAt,
              }
            : null,
        },
      });
    },

    /**
     * Change a duration while preserving the start time, through the same
     * confirmation step so a conflict still needs explicit acceptance.
     */
    async startDurationChange(user, { kind = 'task', item, minutes }) {
      const duration = positiveMinutes(minutes);
      const timeZone = user.timezone || 'Africa/Nairobi';
      const startValue = kind === 'event' ? item.starts_at : item.scheduled_start;

      if (!startValue) {
        throw new AppError('Schedule the item first, then change its duration.', {
          statusCode: 409,
          code: 'SCHEDULE_REQUIRED',
        });
      }

      const startMinutes = minutesOfDay(startValue, timeZone);
      if (startMinutes + duration > 24 * 60) {
        throw new AppError('That duration runs past midnight.', {
          statusCode: 400,
          code: 'TIME_ORDER_INVALID',
        });
      }

      const date = zonedDateOf(startValue, timeZone);
      const start = minutesToHHMM(startMinutes);
      const end = minutesToHHMM(startMinutes + duration);

      await sessions.start(user, {
        flow: SCHEDULE_FLOW,
        step: 'schedule_confirm',
        payload: {
          kind,
          ref: item.id.slice(0, 8),
          title: item.title,
          date,
          start,
          end,
          durationMinutes: duration,
          pendingDurationMinutes: duration,
          originalDate: date,
          originalStart: start,
          originalEnd:
            kind === 'event'
              ? minutesToHHMM(minutesOfDay(item.ends_at, timeZone))
              : item.scheduled_end
                ? minutesToHHMM(minutesOfDay(item.scheduled_end, timeZone))
                : null,
          isFixed:
            kind === 'event'
              ? Boolean(item.is_fixed)
              : item.scheduling_type === 'fixed',
          conflict: null,
        },
        replace: true,
      });

      return this.previewSchedule(user, {
        kind,
        ref: item.id.slice(0, 8),
        title: item.title,
        date,
        start,
        end,
      });
    },

    async saveSchedule(user, { acceptConflict = false } = {}) {
      const session = await scheduleSession(user);

      if (!['schedule_confirm', 'schedule_end'].includes(session.step)) {
        throw new AppError('Confirm the new time first.', {
          statusCode: 409,
          code: 'FLOW_STEP_MISMATCH',
        });
      }

      const result = await plans.saveScheduledChange(user, {
        kind: session.payload.kind,
        reference: session.payload.ref,
        date: session.payload.date,
        start: session.payload.start,
        end: session.payload.end,
        estimatedMinutes: session.payload.pendingDurationMinutes ?? null,
        acceptConflict,
      });

      await sessions.clear(user);

      return result;
    },
  };
}

function expired() {
  return new AppError('That form has expired. Tap Add task to start again.', {
    statusCode: 410,
    code: 'FLOW_EXPIRED',
  });
}

export { DURATION_MINUTES, isDateString, formatDateLong };
