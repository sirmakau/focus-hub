import { createSessionService } from './session.service.js';
import { createPlanService } from './plan.service.js';
import { AppError } from '../middleware/error-handler.js';
import {
  endOfZonedDay,
  formatDateLong,
  isDateString,
  isTimeString,
  zonedWallTimeToUtc,
} from '../utils/dates.js';

export const ADD_FLOW = 'add_task';
export const EDIT_FLOW = 'edit_task';

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

    async startEdit(user, task) {
      return sessions.start(user, {
        flow: EDIT_FLOW,
        step: 'edit_menu',
        payload: { taskRef: task.id.slice(0, 8), title: task.title },
        replace: true,
      });
    },

    async requestEditTitle(user) {
      const session = await sessions.get(user);
      if (!session) throw expired();

      return sessions.update(user, { step: 'edit_title', payload: session.payload });
    },

    async applyEdit(user, field, value) {
      const session = await sessions.get(user);

      if (!session || session.flow !== EDIT_FLOW) {
        throw new AppError('That form has expired. Open the task again.', {
          statusCode: 410,
          code: 'FLOW_EXPIRED',
        });
      }

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
      } else {
        throw new AppError('That edit is not supported.', {
          statusCode: 400,
          code: 'EDIT_FIELD_INVALID',
        });
      }

      const task = await plans.editTask(user, session.payload.taskRef, fields, {
        reason: `Edited ${field} from the planner`,
      });

      await sessions.clear(user);

      return { task, field };
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
