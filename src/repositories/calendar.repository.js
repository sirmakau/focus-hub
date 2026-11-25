import { query } from '../config/database.js';

const EVENT_COLUMNS = `id, title, description, event_type, location, starts_at, ends_at,
  is_fixed, recurrence_rule`;

export function createCalendarRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    async findBetween(client, userId, rangeStart, rangeEnd) {
      const { rows } = await exec(client)(
        `SELECT ${EVENT_COLUMNS} FROM calendar_events
         WHERE user_id = $1 AND starts_at < $3 AND ends_at > $2
         ORDER BY starts_at`,
        [userId, rangeStart, rangeEnd]
      );
      return rows;
    },

    async findForDay(client, userId, dayStart, dayEnd) {
      return this.findBetween(client, userId, dayStart, dayEnd);
    },
  };
}
