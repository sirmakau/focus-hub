import { query } from '../config/database.js';

export function createEnergyRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    /** Latest check-in, or null when the user has never checked in. */
    async findLatest(client, userId) {
      const { rows } = await exec(client)(
        `SELECT energy_level, optional_note, recorded_at
         FROM energy_checkins
         WHERE user_id = $1
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [userId]
      );
      return rows[0] ?? null;
    },

    async record(client, userId, { energyLevel, note }) {
      const { rows } = await exec(client)(
        `INSERT INTO energy_checkins (user_id, energy_level, optional_note)
         VALUES ($1, $2, $3)
         RETURNING energy_level, optional_note, recorded_at`,
        [userId, energyLevel, note ?? null]
      );
      return rows[0];
    },
  };
}
