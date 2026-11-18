import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  type NewSegmentRun,
  PrismaSearchSegmentsRepository,
} from './segments.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates search_segment_runs.
 * (segments.postgres.spec.ts has its own segments_test database.)
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-14T10:00:00Z');
const t1 = new Date('2026-11-14T11:00:00Z');
const t2 = new Date('2026-11-14T12:00:00Z');

describe.skipIf(!url)('segment run costs in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaSearchSegmentsRepository;

  const run = (
    over: Partial<NewSegmentRun> = {},
  ): NewSegmentRun & { id: string } => ({
    id: randomUUID(),
    channel: Channel.LINKEDIN_JOB_BOARD,
    segmentKey: 'k',
    segmentHash: randomUUID(),
    queryIds: [],
    windowStart: t0,
    windowEnd: t1,
    startedAt: t1,
    finishedAt: t1,
    status: 'succeeded',
    fetched: 0,
    costMicroUsd: 147_200,
    capped: false,
    truncatedQueryIds: [],
    perQuery: {},
    searchTotals: null,
    error: null,
    apifyRunId: 'apify-run',
    costFinalAt: null,
    ...over,
  });

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
    repo = new PrismaSearchSegmentsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw.sql`TRUNCATE collection_batches, search_segment_runs CASCADE`
        .affectedCount()
        .build(),
    );
  });

  it("lists only the channel's unsettled runs with a run id since the given time", async () => {
    const wanted = run({ apifyRunId: 'wanted' });
    await repo.recordRun(wanted);
    await repo.recordRun(run({ apifyRunId: null }));
    await repo.recordRun(run({ costFinalAt: t2 }));
    await repo.recordRun(run({ finishedAt: t0 }));
    await repo.recordRun(run({ channel: Channel.LINKEDIN_JOB_BOARD_BEBITY }));

    expect(await repo.unsettledCosts(Channel.LINKEDIN_JOB_BOARD, t1)).toEqual([
      { id: wanted.id, apifyRunId: 'wanted', finishedAt: t1 },
    ]);
  });

  it('settleCost stores the cost and final time', async () => {
    const stored = run();
    await repo.recordRun(stored);

    await repo.settleCost(stored.id, 151_400, t2);

    const row = await db.orm.public.SearchSegmentRun.where({
      id: stored.id,
    }).first();
    expect(row).toMatchObject({ costMicroUsd: 151_400, costFinalAt: t2 });
    expect(await repo.unsettledCosts(Channel.LINKEDIN_JOB_BOARD, t0)).toEqual(
      [],
    );
  });
});
