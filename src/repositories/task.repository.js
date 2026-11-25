import { query } from '../config/database.js';

const TASK_COLUMNS = `id, user_id, category_id, title, description, status, priority,
  scheduling_type, estimated_minutes, scheduled_start, scheduled_end, deadline,
  completed_at, auto_reschedule, created_at, updated_at`;

const EDITABLE_COLUMNS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  categoryId: 'category_id',
  schedulingType: 'scheduling_type',
  estimatedMinutes: 'estimated_minutes',
  deadline: 'deadline',
};

/**
 * All methods take an optional transaction client as the first argument so the
 * service can group a task change and its history row in one transaction.
 */
export function createTaskRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    async create(client, attributes) {
      const { rows } = await exec(client)(
        `INSERT INTO tasks
           (user_id, title, description, priority, scheduling_type, category_id,
            estimated_minutes, scheduled_start, scheduled_end, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${TASK_COLUMNS}`,
        [
          attributes.userId,
          attributes.title,
          attributes.description ?? null,
          attributes.priority ?? 'normal',
          attributes.schedulingType ?? 'flexible',
          attributes.categoryId ?? null,
          attributes.estimatedMinutes ?? null,
          attributes.scheduledStart ?? null,
          attributes.scheduledEnd ?? null,
          attributes.deadline ?? null,
        ]
      );
      return rows[0];
    },

    async findById(client, id, userId) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      return rows[0] ?? null;
    },

    /**
     * Resolve a task from a short id prefix (as printed by the bot) scoped to
     * the requesting user.
     */
    async findByPrefix(client, userId, prefix) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1 AND id::text LIKE $2 || '%'
         ORDER BY created_at DESC
         LIMIT 2`,
        [userId, prefix]
      );
      if (rows.length > 1) {
        return { ambiguous: true, task: null };
      }
      return { ambiguous: false, task: rows[0] ?? null };
    },

    async findForToday(client, userId, timezone) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1
           AND status <> 'cancelled'
           AND scheduled_start IS NOT NULL
           AND (scheduled_start AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
         ORDER BY scheduled_start`,
        [userId, timezone]
      );
      return rows;
    },

    async findScheduledOnDate(client, userId, timezone, date) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1
           AND status <> 'cancelled'
           AND scheduled_start IS NOT NULL
           AND (scheduled_start AT TIME ZONE $2)::date = $3::date
         ORDER BY scheduled_start`,
        [userId, timezone, date]
      );
      return rows;
    },

    async findScheduledBetween(client, userId, rangeStart, rangeEnd) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1
           AND status <> 'cancelled'
           AND scheduled_start >= $2
           AND scheduled_start < $3
         ORDER BY scheduled_start`,
        [userId, rangeStart, rangeEnd]
      );
      return rows;
    },

    async findPending(client, userId) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1 AND status IN ('pending', 'in_progress')
         ORDER BY scheduled_start NULLS LAST, created_at
         LIMIT 20`,
        [userId]
      );
      return rows;
    },

    async findUnscheduled(client, userId) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1
           AND status IN ('pending', 'in_progress')
           AND scheduled_start IS NULL
         ORDER BY created_at`,
        [userId]
      );
      return rows;
    },

    async findOpenPage(client, userId, { limit = 8, offset = 0 } = {}) {
      const { rows } = await exec(client)(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE user_id = $1 AND status IN ('pending', 'in_progress')
         ORDER BY scheduled_start NULLS LAST, created_at
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
      return rows;
    },

    async countOpen(client, userId) {
      const { rows } = await exec(client)(
        `SELECT COUNT(*)::int AS total FROM tasks
         WHERE user_id = $1 AND status IN ('pending', 'in_progress')`,
        [userId]
      );
      return rows[0].total;
    },

    async updateStatus(client, id, userId, status) {
      const { rows } = await exec(client)(
        `UPDATE tasks
         SET status = $3,
             completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING ${TASK_COLUMNS}`,
        [id, userId, status]
      );
      return rows[0] ?? null;
    },

    async updateSchedule(client, id, userId, { scheduledStart, scheduledEnd }) {
      const { rows } = await exec(client)(
        `UPDATE tasks
         SET scheduled_start = $3,
             scheduled_end = $4,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING ${TASK_COLUMNS}`,
        [id, userId, scheduledStart, scheduledEnd]
      );
      return rows[0] ?? null;
    },

    async updateFields(client, id, userId, fields) {
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
        `UPDATE tasks
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING ${TASK_COLUMNS}`,
        values
      );
      return rows[0] ?? null;
    },

    async insertHistory(client, entry) {
      const { rows } = await exec(client)(
        `INSERT INTO task_history
           (task_id, user_id, event_type, old_status, new_status,
            old_scheduled_start, new_scheduled_start,
            old_scheduled_end, new_scheduled_end, details, reason, actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         RETURNING id`,
        [
          entry.taskId,
          entry.userId,
          entry.eventType,
          entry.oldStatus ?? null,
          entry.newStatus ?? null,
          entry.oldScheduledStart ?? null,
          entry.newScheduledStart ?? null,
          entry.oldScheduledEnd ?? null,
          entry.newScheduledEnd ?? null,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.reason ?? null,
          entry.actor ?? 'user',
        ]
      );
      return rows[0]?.id ?? null;
    },

    async findHistory(client, taskId, userId, limit = 5) {
      const { rows } = await exec(client)(
        `SELECT id, event_type, old_status, new_status,
                old_scheduled_start, new_scheduled_start,
                old_scheduled_end, new_scheduled_end,
                details, reason, actor, created_at
         FROM task_history
         WHERE task_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [taskId, userId, limit]
      );
      return rows;
    },

    /** Resolve one history row from the short reference used by Undo. */
    async findHistoryByPrefix(client, userId, taskId, prefix) {
      const { rows } = await exec(client)(
        `SELECT id, event_type, details, reason, created_at
         FROM task_history
         WHERE task_id = $1 AND user_id = $2 AND id::text LIKE $3 || '%'
         ORDER BY created_at DESC
         LIMIT 2`,
        [taskId, userId, String(prefix)]
      );
      if (rows.length > 1) return { ambiguous: true, entry: null };
      return { ambiguous: false, entry: rows[0] ?? null };
    },
  };
}
