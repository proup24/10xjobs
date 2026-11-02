import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  createDatabaseClient,
  type DatabaseClient,
} from 'src/database/connection.source';
import {
  type NewCollectionBatch,
  type NewSegmentRun,
  PrismaSearchSegmentsRepository,
} from './segments.repository';

/**
 * Needs SEGMENTS_TEST_DATABASE_URL: a disposable `segments_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Every
 * test on that database lives in this file, so they never run in parallel.
 */
const url = process.env.SEGMENTS_TEST_DATABASE_URL;
const t0 = new Date('2026-11-02T10:00:00Z');
const t1 = new Date('2026-11-02T11:00:00Z');
const t2 = new Date('2026-11-02T12:00:00Z');
const lease = 30 * 60_000;

describe.skipIf(!url)('segment claims in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaSearchSegmentsRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  async function builder(
    over: { coveredUntil?: Date | null; isActive?: boolean } = {},
  ): Promise<string> {
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
      associatedProfiles: over.isActive === false ? 0 : 1,
      isActive: over.isActive ?? true,
      isDeleted: false,
      coveredUntil: over.coveredUntil ?? null,
    });
    return row.id;
  }

  const load = (id: string) =>
    db.orm.public.QuerySearchBuilder.where({ id }).first();

  function run(id: string, queryIds: string[]): NewSegmentRun & { id: string } {
    return {
      id,
      channel: Channel.LINKEDIN_POSTS,
      segmentKey: 'k',
      segmentHash: randomUUID(),
      queryIds,
      windowStart: t0,
      windowEnd: t2,
      startedAt: t2,
      finishedAt: t2,
      status: 'succeeded',
      fetched: 0,
      costMicroUsd: null,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      searchTotals: null,
      error: null,
    };
  }

  const batch = (): NewCollectionBatch => ({
    id: randomUUID(),
    storageKey: `linkedin-posts/${randomUUID()}.json`,
    formatVersion: 1,
    observedAt: t2,
    itemCount: 0,
    actor: 'test',
    apifyRunId: null,
  });

  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/segments_test')
      throw new Error('Use a disposable localhost segments_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaSearchSegmentsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE collection_batches, search_segment_runs, query_search_builder CASCADE`;
  });

  it('claims every free member and returns its cursor', async () => {
    const a = await builder({ coveredUntil: t0 });
    const b = await builder();
    const r1 = randomUUID();

    const result = await repo.claim(
      r1,
      [a, b],
      { since: t0, until: t2 },
      lease,
    );

    expect(result.skipped).toEqual([]);
    expect(
      [...result.claimed].sort((x, y) => x.id.localeCompare(y.id)),
    ).toEqual(
      [
        { id: a, coveredUntil: t0 },
        { id: b, coveredUntil: null },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
    const row = await load(a);
    expect(row?.claimRunId).toBe(r1);
    expect(row?.claimWindowStart).toEqual(t0);
    expect(row?.claimWindowEnd).toEqual(t2);
    const expiresIn = row!.claimExpiresAt!.getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(lease - 60_000);
    expect(expiresIn).toBeLessThanOrEqual(lease + 1_000);
  });

  it('skips a member another run holds live, as in-flight', async () => {
    const a = await builder();
    const b = await builder();
    await repo.claim(randomUUID(), [a], { since: t0, until: t2 }, lease);

    const result = await repo.claim(
      randomUUID(),
      [a, b],
      { since: t0, until: t2 },
      lease,
    );

    expect(result.claimed.map(({ id }) => id)).toEqual([b]);
    expect(result.skipped).toEqual([{ id: a, reason: 'in-flight' }]);
  });

  it('takes over an expired claim', async () => {
    const a = await builder();
    await repo.claim(randomUUID(), [a], { since: t0, until: t2 }, -1_000);
    const r2 = randomUUID();

    const result = await repo.claim(r2, [a], { since: t0, until: t2 }, lease);

    expect(result.claimed.map(({ id }) => id)).toEqual([a]);
    expect((await load(a))?.claimRunId).toBe(r2);
  });

  it('allows a non-overlapping interval', async () => {
    const a = await builder();
    await repo.claim(randomUUID(), [a], { since: t0, until: t1 }, lease);

    const result = await repo.claim(
      randomUUID(),
      [a],
      { since: t1, until: t2 },
      lease,
    );

    expect(result.claimed.map(({ id }) => id)).toEqual([a]);
  });

  it('skips a member whose cursor already reaches until, as already-covered', async () => {
    const a = await builder({ coveredUntil: t2 });

    const result = await repo.claim(
      randomUUID(),
      [a],
      { since: t0, until: t2 },
      lease,
    );

    expect(result.claimed).toEqual([]);
    expect(result.skipped).toEqual([{ id: a, reason: 'already-covered' }]);
  });

  it('never claims inactive builders', async () => {
    const a = await builder({ isActive: false });

    const result = await repo.claim(
      randomUUID(),
      [a],
      { since: t0, until: t2 },
      lease,
    );

    expect(result.claimed).toEqual([]);
    expect((await load(a))?.claimRunId).toBeNull();
  });

  it('releaseClaims clears only its own run', async () => {
    const a = await builder();
    const b = await builder();
    const r1 = randomUUID();
    const r2 = randomUUID();
    await repo.claim(r1, [a], { since: t0, until: t2 }, lease);
    await repo.claim(r2, [b], { since: t0, until: t2 }, lease);

    await repo.releaseClaims(r1);

    const released = await load(a);
    expect(released?.claimRunId).toBeNull();
    expect(released?.claimWindowStart).toBeNull();
    expect(released?.claimWindowEnd).toBeNull();
    expect(released?.claimExpiresAt).toBeNull();
    expect((await load(b))?.claimRunId).toBe(r2);
  });

  it('recordCollectedRun releases and advances in one transaction', async () => {
    const a = await builder();
    const id = randomUUID();
    await repo.claim(id, [a], { since: t0, until: t2 }, lease);

    await repo.recordCollectedRun(run(id, [a]), batch(), [a]);

    const row = await load(a);
    expect(row?.coveredUntil).toEqual(t2);
    expect(row?.claimRunId).toBeNull();
  });

  it('recordRun releases without advancing', async () => {
    const a = await builder({ coveredUntil: t0 });
    const id = randomUUID();
    await repo.claim(id, [a], { since: t0, until: t2 }, lease);

    await repo.recordRun({ ...run(id, [a]), status: 'failed', error: 'x' });

    const row = await load(a);
    expect(row?.coveredUntil).toEqual(t0);
    expect(row?.claimRunId).toBeNull();
  });
});
