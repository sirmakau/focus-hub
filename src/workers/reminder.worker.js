/**
 * Reminder worker.
 *
 * Current status: skeleton only.
 *
 * Planned behavior:
 * - periodically poll due reminders
 * - claim jobs transactionally with FOR UPDATE SKIP LOCKED
 * - deliver through telegramRequest with bounded retries
 * - record idempotency so restarts do not duplicate reminders
 * - recover stale processing jobs after crashes
 * - back off on temporary delivery failures
 */
export function createReminderWorker() {
  return {
    async start() {
      console.log('[reminder-worker] not implemented');
    },

    async stop() {
      console.log('[reminder-worker] stop not implemented');
    },
  };
}
