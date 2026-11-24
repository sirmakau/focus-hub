import { AppError } from '../middleware/error-handler.js';

export const REMINDER_TYPES = [
  'task_reminder',
  'commitment_reminder',
  'morning_briefing',
  'evening_review',
  'recurring_reminder',
];

export const REMINDER_STATUSES = [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
];

export function createReminderService() {
  return {
    async enqueueReminder(user, reminder) {
      throw new Error('Enqueueing reminders not implemented');
    },

    async getDueReminders() {
      throw new Error('Fetching due reminders not implemented');
    },

    async markSent(reminderId) {
      throw new Error('Marking reminders sent not implemented');
    },

    async recordDeliveryError(reminderId, error) {
      throw new Error('Recording delivery errors not implemented');
    },
  };
}
