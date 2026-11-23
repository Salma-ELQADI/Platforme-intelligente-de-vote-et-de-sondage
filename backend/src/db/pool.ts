import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * A single connection pool shared by the whole application.
 * Every query uses parameter placeholders ($1, $2, ...) so user input is
 * never concatenated into SQL (protection against SQL injection).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Errors on idle clients (e.g. the database restarted) must not crash the process.
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

/** Shorthand for a query that runs on any available pooled connection. */
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

/** A query function usable both with the pool and with a transaction client. */
export type Queryable = Pick<PoolClient, 'query'>;

/**
 * Runs `fn` inside a database transaction (BEGIN ... COMMIT).
 * If `fn` throws, the transaction is rolled back and the error re-thrown,
 * so partial writes can never be persisted.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
