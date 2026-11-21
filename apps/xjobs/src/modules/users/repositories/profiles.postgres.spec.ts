import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { PrismaProfilesRepository } from './profiles.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;

describe.skipIf(!url)('profiles repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaProfilesRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  async function user(): Promise<string> {
    const userId = randomUUID();
    await db.execute(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`
        .affectedCount()
        .build(),
    );
    return userId;
  }

  /** A profile in `state`, then its versions and `updatedAt` set as given. */
  async function profile(
    state: 'draft' | 'published',
    matchVersion: number,
    searchesVersion: number | null,
    updatedAt: string,
    userId?: string,
  ): Promise<{ id: string; userId: string }> {
    const owner = userId ?? (await user());
    const row = await db.orm.public.Profile.create({
      userId: owner,
      position: 'backend_engineer',
      yearsOfExperience: 6,
      timezoneCurrent: 60,
      timezoneMin: -60,
      timezoneMax: 180,
      engagements: ['employee'],
      seniorities: ['senior'],
      noticePeriodDays: 30,
      contractTypes: ['full_time'],
      locations: {
        remote: [{ kind: 'region', code: 'EMEA' }],
        hybrid: [],
        onsite: [],
      },
      languages: [{ lang: 'en', level: 'fluent' }],
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
      state,
      publishedAt: state === 'published' ? new Date() : null,
    } as never);
    // Raw SQL: the ORM would move updatedAt itself.
    await db.execute(
      db.raw
        .sql`UPDATE profiles SET "matchVersion" = ${matchVersion}::int, "updatedAt" = ${updatedAt}::timestamptz WHERE id = ${row.id}::uuid`
        .affectedCount()
        .build(),
    );
    if (searchesVersion !== null)
      await db.execute(
        db.raw
          .sql`UPDATE profiles SET "searchesVersion" = ${searchesVersion}::int WHERE id = ${row.id}::uuid`
          .affectedCount()
          .build(),
      );
    const stored = await db.orm.public.Profile.where({ id: row.id }).first();
    expect(stored).toMatchObject({ matchVersion, searchesVersion });
    return { id: row.id, userId: owner };
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
    repo = new PrismaProfilesRepository({ db } as DatabaseService);
    await sql`INSERT INTO iso_languages (code, label) VALUES ('en', 'English') ON CONFLICT (code) DO NOTHING`;
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE query_search_builder, profiles CASCADE`;
  });

  describe('listSearchesBehind', () => {
    it('lists published profiles never synced or behind, oldest update first', async () => {
      const behind = await profile('published', 3, 2, '2026-01-03T00:00:00Z');
      const never = await profile('published', 0, null, '2026-01-01T00:00:00Z');
      await profile('published', 3, 3, '2026-01-01T00:00:00Z');
      await profile('draft', 3, null, '2026-01-01T00:00:00Z');
      await profile('draft', 3, 1, '2026-01-01T00:00:00Z');

      const rows = await repo.listSearchesBehind(10);

      expect(rows.map((row) => row.id)).toEqual([never.id, behind.id]);
      expect(rows[0].techStack).toEqual([]);
    });

    it('stops at the limit', async () => {
      const first = await profile('published', 1, null, '2026-01-01T00:00:00Z');
      await profile('published', 1, null, '2026-01-02T00:00:00Z');
      await profile('published', 1, null, '2026-01-03T00:00:00Z');

      expect((await repo.listSearchesBehind(1)).map((row) => row.id)).toEqual([
        first.id,
      ]);
      expect(await repo.listSearchesBehind(5)).toHaveLength(3);
    });
  });

  describe('publish', () => {
    it('records searchesVersion when the post search switch is as read', async () => {
      const { id, userId } = await profile(
        'draft',
        4,
        null,
        '2026-01-01T00:00:00Z',
      );
      const published = await repo.publish(userId, id, new Date(), 4, false);
      expect(published).toMatchObject({ id, state: 'published' });
      expect(published!.publishedAt).toBeInstanceOf(Date);
      // The publish itself may bump matchVersion; what matters is the recorded searchesVersion.
      expect(published!.searchesVersion).toBe(4);
    });

    it('leaves searchesVersion null when the switch moved since the read', async () => {
      const { id, userId } = await profile(
        'draft',
        4,
        null,
        '2026-01-01T00:00:00Z',
      );
      await db.execute(
        db.raw
          .sql`UPDATE profiles SET "postSearch" = true WHERE id = ${id}::uuid`
          .affectedCount()
          .build(),
      );
      const published = await repo.publish(userId, id, new Date(), 4, false);
      expect(published).toMatchObject({
        state: 'published',
        searchesVersion: null,
      });
      // So the search sync picks it up.
      expect((await repo.listSearchesBehind(10)).map((row) => row.id)).toEqual([
        id,
      ]);
    });

    it('is null for a published profile or another user', async () => {
      const { id, userId } = await profile(
        'draft',
        0,
        null,
        '2026-01-01T00:00:00Z',
      );
      expect(
        await repo.publish(randomUUID(), id, new Date(), 0, false),
      ).toBeNull();
      expect(
        await repo.publish(userId, id, new Date(), 0, false),
      ).not.toBeNull();
      expect(await repo.publish(userId, id, new Date(), 0, false)).toBeNull();
    });
  });
});
