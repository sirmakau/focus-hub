import { query } from '../config/database.js';

const TASK_COLUMNS = `id, user_id, category_id, title, description, status, priority,
  scheduling_type, estimated_minutes, scheduled_start, scheduled_end, deadline,
  completed_at, auto_reschedule, created_at, updated_at`;

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
           (user_id, title, description, priority, scheduling_type,
            estimated_minutes, scheduled_start, scheduled_end, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${TASK_COLUMNS}`,
        [
          attributes.userId,
          attributes.title,
          attributes.description ?? null,
          attributes.priority ?? 'normal',
          attributes.schedulingType ?? 'flexible',
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

    async insertHistory(client, entry) {
      await exec(client)(
        `INSERT INTO task_history
           (task_id, user_id, event_type, old_status, new_status, reason, actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.taskId,
          entry.userId,
          entry.eventType,
          entry.oldStatus ?? null,
          entry.newStatus ?? null,
          entry.reason ?? null,
          entry.actor ?? 'user',
        ]
      );
    },

    async findHistory(client, taskId, userId) {
      const { rows } = await exec(client)(
        `SELECT event_type, old_status, new_status, reason, actor, created_at
         FROM task_history
         WHERE task_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [taskId, userId]
      );
      return rows;
    },
  };
}
