/**
 * Reminder queue repository.
 *
 * Planned operations:
 * - insert reminder
 * - claim pending reminders with FOR UPDATE SKIP LOCKED
 * - mark sent
 * - mark failed
 * - recover stale processing jobs
 */

export function createReminderRepository() {
  return {
    async insert(reminder) {
      throw new Error('Reminder repository insert not implemented');
    },

    async claimDue(limit = 50) {
      throw new Error('Reminder repository claimDue not implemented');
    },

    async markSent(id) {
      throw new Error('Reminder repository markSent not implemented');
    },

    async markFailed(id, error) {
      throw new Error('Reminder repository markFailed not implemented');
    },

    async recoverStaleProcessing() {
      throw new Error('Reminder repository recoverStaleProcessing not implemented');
    },
  };
}
