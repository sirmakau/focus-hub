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

/**
 * Task service placeholder.
 *
 * Real implementations should:
 * - use task.repository for persistence
 * - record task_history in the same transaction
 * - verify task ownership for the requesting user
 * - validate input with Zod or equivalent before persistence
 */
export function createTaskService() {
  return {
    async createTask(user, input) {
      throw new Error('Task creation not implemented');
    },

    async listTodayTasks(user) {
      throw new Error('Listing today tasks not implemented');
    },

    async listTomorrowTasks(user) {
      throw new Error('Listing tomorrow tasks not implemented');
    },

    async markCompleted(user, taskId, actor = 'user') {
      throw new Error('Marking tasks completed not implemented');
    },

    async skipTask(user, taskId, reason, actor = 'user') {
      throw new Error('Skipping tasks not implemented');
    },

    async postponeTask(user, taskId, newScheduledStart, reason, actor = 'user') {
      throw new Error('Postponing tasks not implemented');
    },

    async rescheduleTask(user, taskId, newScheduledStart, newScheduledEnd, reason, actor = 'user') {
      throw new Error('Rescheduling tasks not implemented');
    },
  };
}
