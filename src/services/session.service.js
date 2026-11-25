import { createPlannerSessionRepository } from '../repositories/planner-session.repository.js';
import { AppError } from '../middleware/error-handler.js';

export const FLOW_TTL_MINUTES = 30;

/**
 * Durable store for the active guided conversation of each user.
 * One flow at a time: starting a new one replaces the previous session.
 */
export function createSessionService({
  repo = createPlannerSessionRepository(),
  ttlMinutes = FLOW_TTL_MINUTES,
  now = () => new Date(),
} = {}) {
  function isExpired(session) {
    if (!session) return true;
    return new Date(session.expires_at).getTime() <= now().getTime();
  }

  return {
    async get(user) {
      const session = await repo.findByUserId(null, user.id);

      if (!session) return null;

      if (isExpired(session)) {
        await repo.remove(null, user.id);
        return null;
      }

      return session;
    },

    /**
     * @throws {AppError} when another flow is already running
     */
    async start(user, { flow, step, payload = {}, replace = false }) {
      if (!replace) {
        const existing = await this.get(user);
        if (existing) {
          throw new AppError(
            'You already have a task in progress. Finish it or cancel it first.',
            { statusCode: 409, code: 'FLOW_ALREADY_ACTIVE' }
          );
        }
      }

      const session = await repo.upsert(null, {
        userId: user.id,
        flow,
        step,
        payload,
        ttlMinutes,
      });

      return session;
    },

    async update(user, { step, payload }) {
      const session = await this.get(user);

      if (!session) {
        throw new AppError('That form has expired. Tap Add task to start again.', {
          statusCode: 410,
          code: 'FLOW_EXPIRED',
        });
      }

      // Re-saving refreshes the expiry window.
      return repo.upsert(null, {
        userId: user.id,
        flow: session.flow,
        step: step ?? session.step,
        payload: payload ?? session.payload,
        ttlMinutes,
      });
    },

    async clear(user) {
      await repo.remove(null, user.id);
    },
  };
}
