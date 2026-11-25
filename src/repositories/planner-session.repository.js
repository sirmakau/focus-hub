import { query } from '../config/database.js';

const SESSION_COLUMNS = 'user_id, flow, step, payload, created_at, updated_at, expires_at';

export function createPlannerSessionRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    async findByUserId(client, userId, { forUpdate = false } = {}) {
      const { rows } = await exec(client)(
        `SELECT ${SESSION_COLUMNS} FROM planner_sessions
         WHERE user_id = $1
         ${forUpdate ? 'FOR UPDATE' : ''}`,
        [userId]
      );
      return rows[0] ?? null;
    },

    async upsert(client, session) {
      const { rows } = await exec(client)(
        `INSERT INTO planner_sessions (user_id, flow, step, payload, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW() + ($5 || ' minutes')::interval)
         ON CONFLICT (user_id) DO UPDATE
           SET flow = EXCLUDED.flow,
               step = EXCLUDED.step,
               payload = EXCLUDED.payload,
               updated_at = NOW(),
               expires_at = EXCLUDED.expires_at
         RETURNING ${SESSION_COLUMNS}`,
        [
          session.userId,
          session.flow,
          session.step,
          JSON.stringify(session.payload ?? {}),
          String(session.ttlMinutes ?? 30),
        ]
      );
      return rows[0];
    },

    async remove(client, userId) {
      await exec(client)('DELETE FROM planner_sessions WHERE user_id = $1', [userId]);
    },

    async removeExpired(client) {
      await exec(client)('DELETE FROM planner_sessions WHERE expires_at <= NOW()');
    },
  };
}
