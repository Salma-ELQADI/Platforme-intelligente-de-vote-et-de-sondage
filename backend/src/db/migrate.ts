import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { env } from '../config/env';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
// Arbitrary constant used to make sure two processes never migrate at the same time.
const MIGRATION_LOCK_ID = 727_001;

/**
 * Minimal, explicit migration runner:
 *  - migrations are plain .sql files applied in alphabetical order;
 *  - each file runs in its own transaction (all or nothing);
 *  - applied files are recorded in the schema_migrations table.
 */
export async function runMigrations(databaseUrl = env.DATABASE_URL, log = console.log): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (applied.length === 0) log('Database schema is up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
