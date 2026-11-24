import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pool } from '../src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function schemaAlreadyExists(client) {
  const { rows } = await client.query(
    "SELECT to_regclass('public.users') AS existing"
  );
  return rows[0].existing !== null;
}

async function run() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] no migration files found');
    process.exit(0);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(CREATE_TRACKING_TABLE);

    const { rows: appliedRows } = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    const applied = new Set(appliedRows.map((row) => row.filename));

    // Databases that predate migration tracking already have the schema.
    if (applied.size === 0 && (await schemaAlreadyExists(client))) {
      const initial = files.find((file) => file === '001_initial_schema.sql');
      if (initial) {
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [initial]
        );
        applied.add(initial);
        console.log(
          '[migrate] existing schema detected; marking 001_initial_schema.sql as applied'
        );
      }
    }

    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      await client.query('COMMIT');
      console.log('[migrate] database is up to date');
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying ${file}...`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
    }

    await client.query('COMMIT');
    console.log(`[migrate] applied ${pending.length} migration(s)`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[migrate] migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
