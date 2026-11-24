import { query } from '../config/database.js';

const USER_COLUMNS = 'id, telegram_id, telegram_chat_id, display_name, timezone';

export function createUserRepository(db = { query }) {
  return {
    async findByTelegramId(telegramId) {
      const { rows } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE telegram_id = $1`,
        [telegramId]
      );
      return rows[0] ?? null;
    },

    async upsertFromTelegram({ telegramId, chatId, displayName, timezone }) {
      const { rows } = await db.query(
        `INSERT INTO users (telegram_id, telegram_chat_id, display_name, timezone)
         VALUES ($1, $2, $3, COALESCE($4, 'Africa/Nairobi'))
         ON CONFLICT (telegram_id) DO UPDATE
           SET telegram_chat_id = EXCLUDED.telegram_chat_id,
               display_name = COALESCE(EXCLUDED.display_name, users.display_name),
               updated_at = NOW()
         RETURNING ${USER_COLUMNS}`,
        [telegramId, chatId, displayName ?? null, timezone ?? null]
      );
      return rows[0];
    },
  };
}
