import { query } from '../config/database.js';

const EVENT_COLUMNS = `id, user_id, title, description, event_type, location, starts_at, ends_at,
  is_fixed, recurrence_rule, created_at, updated_at, deleted_at`;

const EDITABLE_COLUMNS = {
  title: 'title',
  description: 'description',
  eventType: 'event_type',
  location: 'location',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  isFixed: 'is_fixed',
};

export function createCalendarRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    async findBetween(client, userId, rangeStart, rangeEnd) {
      const { rows } = await exec(client)(
        `SELECT ${EVENT_COLUMNS} FROM calendar_events
         WHERE user_id = $1 AND deleted_at IS NULL
           AND starts_at < $3 AND ends_at > $2
         ORDER BY starts_at`,
        [userId, rangeStart, rangeEnd]
      );
      return rows;
    },

    async findForDay(client, userId, dayStart, dayEnd) {
      return this.findBetween(client, userId, dayStart, dayEnd);
    },

    async findById(client, id, userId) {
      const { rows } = await exec(client)(
        `SELECT ${EVENT_COLUMNS} FROM calendar_events
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId]
      );
      return rows[0] ?? null;
    },

    /**
     * Resolve a commitment from the short id prefix shown by the bot, scoped to
     * the requesting user. Deleted commitments are not resolvable.
     */
    async findByPrefix(client, userId, prefix, { includeDeleted = false } = {}) {
      const { rows } = await exec(client)(
        `SELECT ${EVENT_COLUMNS} FROM calendar_events
         WHERE user_id = $1 AND id::text LIKE $2 || '%'
           AND ($3::boolean OR deleted_at IS NULL)
         ORDER BY starts_at DESC
         LIMIT 2`,
        [userId, prefix, includeDeleted]
      );
      if (rows.length > 1) return { ambiguous: true, event: null };
      return { ambiguous: false, event: rows[0] ?? null };
    },

    async updateEvent(client, id, userId, fields) {
      const assignments = [];
      const values = [id, userId];

      for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
        if (fields[key] === undefined) continue;
        values.push(fields[key]);
        assignments.push(`${column} = $${values.length}`);
      }

      if (assignments.length === 0) {
        return this.findById(client, id, userId);
      }

      const { rows } = await exec(client)(
        `UPDATE calendar_events
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING ${EVENT_COLUMNS}`,
        values
      );
      return rows[0] ?? null;
    },

    /** Soft delete keeps the row (and its history) so Undo can restore it. */
    async softDelete(client, id, userId) {
      const { rows } = await exec(client)(
        `UPDATE calendar_events
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING ${EVENT_COLUMNS}`,
        [id, userId]
      );
      return rows[0] ?? null;
    },

    async insertHistory(client, entry) {
      const { rows } = await exec(client)(
        `INSERT INTO calendar_event_history
           (event_id, user_id, event_type,
            old_title, new_title,
            old_description, new_description,
            old_starts_at, new_starts_at,
            old_ends_at, new_ends_at,
            old_is_fixed, new_is_fixed,
            old_deleted_at, new_deleted_at,
            details, reason, actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16::jsonb, $17, $18)
         RETURNING id`,
        [
          entry.eventId,
          entry.userId,
          entry.eventType,
          entry.oldTitle ?? null,
          entry.newTitle ?? null,
          entry.oldDescription ?? null,
          entry.newDescription ?? null,
          entry.oldStartsAt ?? null,
          entry.newStartsAt ?? null,
          entry.oldEndsAt ?? null,
          entry.newEndsAt ?? null,
          entry.oldIsFixed ?? null,
          entry.newIsFixed ?? null,
          entry.oldDeletedAt ?? null,
          entry.newDeletedAt ?? null,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.reason ?? null,
          entry.actor ?? 'user',
        ]
      );
      return rows[0]?.id ?? null;
    },

    async findHistory(client, eventId, userId, limit = 5) {
      const { rows } = await exec(client)(
        `SELECT id, event_type, old_title, new_title,
                old_starts_at, new_starts_at, old_ends_at, new_ends_at,
                details, reason, actor, created_at
         FROM calendar_event_history
         WHERE event_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [eventId, userId, limit]
      );
      return rows;
    },

    async findHistoryByPrefix(client, userId, eventId, prefix) {
      const { rows } = await exec(client)(
        `SELECT id, event_type, details, reason, created_at
         FROM calendar_event_history
         WHERE event_id = $1 AND user_id = $2 AND id::text LIKE $3 || '%'
         ORDER BY created_at DESC
         LIMIT 2`,
        [eventId, userId, String(prefix)]
      );
      if (rows.length > 1) return { ambiguous: true, entry: null };
      return { ambiguous: false, entry: rows[0] ?? null };
    },

    /** Restore a soft-deleted commitment and any values captured by Undo. */
    async restore(client, id, userId, fields = {}) {
      const assignments = ['deleted_at = NULL'];
      const values = [id, userId];

      for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
        if (fields[key] === undefined) continue;
        values.push(fields[key]);
        assignments.push(`${column} = $${values.length}`);
      }

      const { rows } = await exec(client)(
        `UPDATE calendar_events
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING ${EVENT_COLUMNS}`,
        values
      );
      return rows[0] ?? null;
    },
  };
}
