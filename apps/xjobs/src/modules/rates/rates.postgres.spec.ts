import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { PrismaRatesRepository } from './rates.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates exchange_rates.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;

describe.skipIf(!url)('rates repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaRatesRepository;

  beforeAll(() => {
    if (!/@(127\.0\.0\.1|localhost):/.test(url!))
      throw new Error('Use a disposable localhost processor_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaRatesRepository({ db } as DatabaseService);
  });
  beforeEach(async () => {
    await db.execute(
      db.raw.sql`TRUNCATE exchange_rates`.affectedCount().build(),
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it('stores rates and reads them back as numbers', async () => {
    await repo.upsertMany(
      new Map([
        ['MAD', 9.80215],
        ['EUR', 0.899865],
      ]),
    );
    expect(await repo.all()).toEqual(
      new Map([
        ['MAD', 9.80215],
        ['EUR', 0.899865],
      ]),
    );
  });

  it('replaces an existing rate and keeps the others', async () => {
    await repo.upsertMany(
      new Map([
        ['MAD', 9.8],
        ['EUR', 0.9],
      ]),
    );
    await repo.upsertMany(new Map([['MAD', 10]]));
    expect(await repo.all()).toEqual(
      new Map([
        ['MAD', 10],
        ['EUR', 0.9],
      ]),
    );
  });
});
