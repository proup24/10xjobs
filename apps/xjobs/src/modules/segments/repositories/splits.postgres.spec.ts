import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { PrismaLinkedinSearchSplitsRepository } from './splits.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its table.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-14T10:00:00Z');
const t1 = new Date('2026-11-14T11:00:00Z');

describe.skipIf(!url)('search splits in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaLinkedinSearchSplitsRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/processor_test'
    )
      throw new Error('Use a disposable localhost processor_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaLinkedinSearchSplitsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE linkedin_search_splits`;
  });

  it('remembers a split and reads it back', async () => {
    await repo.setParts('k', 4, t0);
    expect(await repo.parts()).toEqual(
      new Map([['k', { parts: 4, splitAt: t0 }]]),
    );
  });

  it('replaces the split of a key on a second write', async () => {
    await repo.setParts('k', 4, t0);
    await repo.setParts('k', 2, t1);
    expect(await repo.parts()).toEqual(
      new Map([['k', { parts: 2, splitAt: t1 }]]),
    );
  });

  it('forgets a key when parts is 1, and only that key', async () => {
    await repo.setParts('k', 4, t0);
    await repo.setParts('other', 3, t0);
    await repo.setParts('k', 1, t1);
    expect([...(await repo.parts()).keys()]).toEqual(['other']);
  });

  it('prunes every split whose group key is not kept, JSON keys included', async () => {
    const kept = 'LINKEDIN_JOB_BOARD|remote|group:{"place":{"geoId":"1"},"workplaceType":["remote"]}';
    const stale = 'LINKEDIN_JOB_BOARD|remote|group:{"place":{"geoId":"2"}}';
    await repo.setParts(kept, 2, t0);
    await repo.setParts(stale, 3, t0);
    await repo.setParts('other', 2, t0);
    expect(await repo.prune([kept, 'absent'])).toBe(2);
    expect([...(await repo.parts()).keys()]).toEqual([kept]);
    expect(await repo.prune([kept])).toBe(0);
  });

  it('prunes every split when nothing is kept', async () => {
    await repo.setParts('k', 2, t0);
    expect(await repo.prune([])).toBe(1);
    expect((await repo.parts()).size).toBe(0);
  });

  it('refuses a stored split below 1 part at the database', async () => {
    await expect(
      db.execute(
        db.raw
          .sql`INSERT INTO linkedin_search_splits ("groupKey", parts, "splitAt") VALUES ('z', 0, now())`
          .affectedCount()
          .build(),
      ),
    ).rejects.toThrow();
  });
});
