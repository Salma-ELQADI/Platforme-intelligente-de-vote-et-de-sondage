import { Client } from 'pg';

/** Runs once before all test files: recreates a clean schema in the TEST database. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://votelive:votelive@localhost:5432/votelive_test';
  if (!/test/.test(url)) throw new Error('Refusing to reset a database whose name does not contain "test"');

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();

  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123456';
  const { runMigrations } = await import('../src/db/migrate.js');
  await runMigrations(url, () => undefined);
}
