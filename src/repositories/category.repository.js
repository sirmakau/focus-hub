import { query } from '../config/database.js';

export const DEFAULT_CATEGORIES = [
  'University',
  'Software Engineering',
  'AutoStack Studios',
  'Sir Anon',
  'Faith',
  'Personal',
  'Household',
  'Finance',
  'Health & Rest',
];

export function createCategoryRepository(db = { query }) {
  const exec = (client) => (client ? client.query.bind(client) : db.query);

  return {
    async listForUser(client, userId) {
      const { rows } = await exec(client)(
        `SELECT id, name, color FROM categories
         WHERE user_id = $1
         ORDER BY created_at, name`,
        [userId]
      );
      return rows;
    },

    /**
     * Make sure the default categories exist for a user. Existing rows are
     * left untouched (names are unique per user).
     */
    async ensureDefaults(client, userId) {
      await exec(client)(
        `INSERT INTO categories (user_id, name)
         SELECT $1, name FROM unnest($2::text[]) AS name
         ON CONFLICT (user_id, name) DO NOTHING`,
        [userId, DEFAULT_CATEGORIES]
      );
    },
  };
}
