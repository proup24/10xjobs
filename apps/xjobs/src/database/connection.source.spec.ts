import { createDatabaseClient } from './connection.source';

describe('createDatabaseClient', () => {
  it('constructs a client for the contract, which declares the Supabase pack', async () => {
    const db = createDatabaseClient({
      url: 'postgresql://postgres:postgres@127.0.0.1:1/postgres',
      connectionTimeoutMs: 1000,
      idleTimeoutMs: 1000,
      slowQueryMs: 1000,
      logQueries: false,
    });
    await db.close();
  });
});
