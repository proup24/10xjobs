import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import { PrismaSearchSegmentsRepository } from 'src/modules/segments/repositories/segments.repository';
import { PrismaPostsBudgetRepository } from './posts-budget.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables; files on
 * that database run one at a time (see `vitest.config.mts`).
 */
const url = process.env.INGEST_TEST_DATABASE_URL;
const at = (hour: number) => new Date(Date.UTC(2026, 10, 27, hour, 0, 0));

describe.skipIf(!url)('posts budget report in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaPostsBudgetRepository;
  let segments: PrismaSearchSegmentsRepository;

  async function exec(statement: ReturnType<DatabaseClient['raw']['sql']>) {
    await db.execute(statement.affectedCount().build());
  }

  async function recordRun(over: {
    channel?: Channel;
    segmentKey: string;
    startedAt: Date;
    costMicroUsd?: number | null;
    truncatedQueryIds?: string[];
  }): Promise<void> {
    await segments.recordRun({
      id: randomUUID(),
      channel: over.channel ?? Channel.LINKEDIN_POSTS,
      segmentKey: over.segmentKey,
      segmentHash: randomUUID(),
      queryIds: [],
      windowStart: new Date(over.startedAt.getTime() - 3_600_000),
      windowEnd: over.startedAt,
      startedAt: over.startedAt,
      finishedAt: new Date(over.startedAt.getTime() + 60_000),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd:
        over.costMicroUsd === undefined ? 100_000 : over.costMicroUsd,
      capped: false,
      truncatedQueryIds: over.truncatedQueryIds ?? [],
      perQuery: {},
      searchTotals: null,
      error: null,
      apifyRunId: null,
      costFinalAt: null,
    });
  }

  async function profile(): Promise<string> {
    const userId = randomUUID();
    await exec(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`,
    );
    await exec(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    const row = await db.orm.public.Profile.create({
      userId,
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
      state: 'published',
      publishedAt: new Date(),
    } as never);
    return row.id;
  }

  async function builder(): Promise<string> {
    const row = await db.orm.public.QuerySearchBuilder.create({
      channel: Channel.LINKEDIN_POSTS,
      location: 'worldwide',
      experience: 'senior',
      technologies: [],
      domain: 'backend',
      type: 'remote',
      keyword: 'backend',
      version: 1,
      params: {},
      hash: randomUUID(),
      associatedProfiles: 0,
      isActive: false,
      isDeleted: false,
    });
    return row.id;
  }

  async function link(profileId: string, queryId: string): Promise<void> {
    await exec(
      db.raw
        .sql`INSERT INTO profile_query_search_builders (id, "profileId", "queryId")
        VALUES (${randomUUID()}::uuid, ${profileId}::uuid, ${queryId}::uuid)`,
    );
  }

  beforeAll(() => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/ingest_test')
      throw new Error('Use a disposable localhost ingest_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaPostsBudgetRepository({ db } as DatabaseService);
    segments = new PrismaSearchSegmentsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await exec(
      db.raw
        .sql`TRUNCATE collection_batches, search_segment_runs, profile_query_search_builders, query_search_builder CASCADE`,
    );
  });

  it('lists the posts runs since the given time, oldest first, with full set when a query was truncated', async () => {
    await recordRun({ segmentKey: 'late', startedAt: at(12) });
    await recordRun({
      segmentKey: 'early',
      startedAt: at(10),
      costMicroUsd: null,
      truncatedQueryIds: [randomUUID()],
    });
    await recordRun({ segmentKey: 'before', startedAt: at(8) });
    await recordRun({
      channel: Channel.LINKEDIN_JOB_BOARD,
      segmentKey: 'board',
      startedAt: at(11),
    });

    const runs = await repo.runsSince(at(10));

    expect(runs).toEqual([
      {
        segmentKey: 'early',
        startedAt: at(10),
        finishedAt: new Date(at(10).getTime() + 60_000),
        costMicroUsd: null,
        full: true,
      },
      {
        segmentKey: 'late',
        startedAt: at(12),
        finishedAt: new Date(at(12).getTime() + 60_000),
        costMicroUsd: 100_000,
        full: false,
      },
    ]);
  });

  it('maps each builder to its profile ids, leaving out builders not asked for', async () => {
    const p1 = await profile();
    const p2 = await profile();
    const a = await builder();
    const b = await builder();
    const other = await builder();
    await link(p1, a);
    await link(p2, a);
    await link(p2, b);
    await link(p1, other);

    const profiles = await repo.profilesFor([a, b]);

    expect([...profiles.keys()].sort()).toEqual([a, b].sort());
    expect(profiles.get(a)?.sort()).toEqual([p1, p2].sort());
    expect(profiles.get(b)).toEqual([p2]);
    expect(await repo.profilesFor([])).toEqual(new Map());
  });
});
