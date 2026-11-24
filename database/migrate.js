import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pool } from '../src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');

async function run() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] no migration files found');
    process.exit(0);
  }

  console.log('[migrate] found migrations:', files.join(', '));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying ${file}...`);
      await client.query(sql);
    }

    await client.query('COMMIT');
    console.log('[migrate] all migrations applied successfully');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[migrate] migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

run();
