import { transaction } from '../config/database.js';
import { createTaskRepository } from '../repositories/task.repository.js';
import { AppError } from '../middleware/error-handler.js';

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'cancelled',
];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const SCHEDULING_TYPES = ['fixed', 'flexible'];

export const HISTORY_EVENT_TYPES = [
  'created',
  'completed',
  'skipped',
  'rescheduled',
  'postponed',
  'priority_changed',
  'status_changed',
  'auto_adjusted',
  'cancelled',
  'restored',
];

export const ACTORS = ['user', 'system', 'ai'];

const MAX_TITLE_LENGTH = 200;

function validateTitle(title) {
  const trimmed = typeof title === 'string' ? title.trim() : '';

  if (trimmed.length === 0) {
    throw new AppError('A task needs a title', {
      statusCode: 400,
      code: 'TASK_TITLE_REQUIRED',
    });
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new AppError(`Task titles are limited to ${MAX_TITLE_LENGTH} characters`, {
      statusCode: 400,
      code: 'TASK_TITLE_TOO_LONG',
    });
  }

  return trimmed;
}

export function createTaskService({
  repo = createTaskRepository(),
  runInTransaction = transaction,
} = {}) {
  async function resolveTask(client, user, reference) {
    const prefix = String(reference ?? '').trim().toLowerCase();

    if (!/^[0-9a-f]{4,36}$/.test(prefix)) {
      throw new AppError('Send the task reference shown in /pending, e.g. /done 1a2b3c4d', {
        statusCode: 400,
        code: 'TASK_REFERENCE_INVALID',
      });
    }

    const { ambiguous, task } = await repo.findByPrefix(client, user.id, prefix);

    if (ambiguous) {
      throw new AppError('That reference matches more than one task; send a longer prefix', {
        statusCode: 409,
        code: 'TASK_REFERENCE_AMBIGUOUS',
      });
    }

    if (!task) {
      throw new AppError('No task found for that reference', {
        statusCode: 404,
        code: 'TASK_NOT_FOUND',
      });
    }

    return task;
  }

  return {
    async createTask(user, input = {}) {
      const title = validateTitle(input.title);

      return runInTransaction(async (client) => {
        const task = await repo.create(client, {
          userId: user.id,
          title,
          description: input.description,
          priority: input.priority,
          schedulingType: input.schedulingType,
          estimatedMinutes: input.estimatedMinutes,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          deadline: input.deadline,
        });

        await repo.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: 'created',
          newStatus: task.status,
          actor: input.actor ?? 'user',
        });

        return task;
      });
    },

    async listTodayTasks(user) {
      return repo.findForToday(null, user.id, user.timezone ?? 'Africa/Nairobi');
    },

    async listPendingTasks(user) {
      return repo.findPending(null, user.id);
    },

    async completeTask(user, reference) {
      return runInTransaction(async (client) => {
        const task = await resolveTask(client, user, reference);

        if (task.status === 'completed') {
          throw new AppError('That task is already completed', {
            statusCode: 409,
            code: 'TASK_ALREADY_COMPLETED',
          });
        }

        const updated = await repo.updateStatus(client, task.id, user.id, 'completed');

        await repo.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: 'completed',
          oldStatus: task.status,
          newStatus: 'completed',
          actor: 'user',
        });

        return updated;
      });
    },

    async cancelTask(user, reference) {
      return runInTransaction(async (client) => {
        const task = await resolveTask(client, user, reference);

        if (task.status === 'cancelled') {
          throw new AppError('That task is already cancelled', {
            statusCode: 409,
            code: 'TASK_ALREADY_CANCELLED',
          });
        }

        const updated = await repo.updateStatus(client, task.id, user.id, 'cancelled');

        await repo.insertHistory(client, {
          taskId: task.id,
          userId: user.id,
          eventType: 'cancelled',
          oldStatus: task.status,
          newStatus: 'cancelled',
          actor: 'user',
        });

        return updated;
      });
    },
  };
}
