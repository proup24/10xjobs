import pg from 'pg';
import { assertLocal } from './stack-env.js';

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Runs `fn` with a direct Postgres connection. For setup, read-back, catalog
 * reads and running the cleanup function the way cron would: the
 * operation under test always goes through supabase-js.
 */
export async function withCatalog<T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;
  assertLocal(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
