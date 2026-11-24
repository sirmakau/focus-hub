import 'dotenv/config';
import { pool } from '../src/config/database.js';
import { AppError } from '../src/middleware/error-handler.js';

/**
 * Seed script skeleton.
 *
 * It intentionally does not insert anything yet because it needs:
 * - a real Telegram user id
 * - a real timezone and preferred briefing/review times
 *
 * When ready, seed:
 * - the first user
 * - default categories
 * - the university timetable as recurring calendar events
 */
export async function seed() {
  console.log('[seed] seed logic not implemented yet');
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed();
    await client.query('COMMIT');
    console.log('[seed] done');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[seed] failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
