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

/** Same disposable database as the ingest Postgres tests; truncates its tables. */
const url = process.env.INGEST_TEST_DATABASE_URL;
const until = new Date('2026-10-31T12:00:00Z');

describe.skipIf(!url)('segment runs and batches in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaSearchSegmentsRepository;
  let queryId: string;

  const run = (): NewSegmentRun & { id: string } => ({
    id: randomUUID(),
    channel: Channel.ASHBY,
    segmentKey: 'k',
    segmentHash: randomUUID(),
    queryIds: [queryId],
    windowStart: new Date('2026-10-31T10:00:00Z'),
    windowEnd: until,
    startedAt: until,
    finishedAt: until,
    status: 'succeeded',
    fetched: 1,
    costMicroUsd: 100,
    capped: false,
    truncatedQueryIds: [],
    perQuery: { [queryId]: { returned: 1 } },
    error: null,
  });
  const batch = (overrides: Partial<NewCollectionBatch> = {}): NewCollectionBatch => ({
    id: randomUUID(),
    storageKey: 'ASHBY/2026-10-31/x.json',
    formatVersion: 1,
    observedAt: until,
    itemCount: 1,
    actor: 'apify/google-search-scraper',
    apifyRunId: 'run-1',
    ...overrides,
  });

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
    repo = new PrismaSearchSegmentsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw
        .sql`TRUNCATE raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs, query_search_builder CASCADE`
        .affectedCount()
        .build(),
    );
    const builder = await db.orm.public.QuerySearchBuilder.create({
      channel: Channel.ASHBY,
      locationRegion: 'GLOBAL',
      experience: 'senior',
      technologies: [],
      domain: 'backend',
      type: 'remote',
      keyword: 'backend',
      version: 1,
      params: {},
      hash: randomUUID(),
      associatedProfiles: 1,
      isActive: true,
      isDeleted: false,
    });
    queryId = builder.id;
  });

  it('records the run, a pending batch and the cursors together', async () => {
    const r = run();
    const b = batch();
    await repo.recordCollectedRun(r, b, [queryId]);

    expect(await db.orm.public.SearchSegmentRun.where({ id: r.id }).first()).toMatchObject({
      status: 'succeeded',
    });
    expect(await db.orm.public.CollectionBatch.where({ id: b.id }).first()).toMatchObject({
      segmentRunId: r.id,
      channel: Channel.ASHBY,
      status: 'pending',
      attempts: 0,
    });
    expect(
      (await db.orm.public.QuerySearchBuilder.where({ id: queryId }).first())!.coveredUntil,
    ).toEqual(until);
  });

  it('writes nothing when the batch cannot be inserted', async () => {
    const r = run();
    const first = batch();
    await repo.recordCollectedRun(r, first, []);
    // Same batch id again: the insert fails, so neither run nor cursor may land.
    const second = run();
    await expect(
      repo.recordCollectedRun(second, batch({ id: first.id }), [queryId]),
    ).rejects.toThrow();

    expect(await db.orm.public.SearchSegmentRun.where({ id: second.id }).first()).toBeNull();
    expect(
      (await db.orm.public.QuerySearchBuilder.where({ id: queryId }).first())!.coveredUntil,
    ).toBeNull();
  });
});
