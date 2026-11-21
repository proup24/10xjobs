import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import {
  PrismaSilencedAuthorsRepository,
  silencedPostJobSql,
} from './silenced-authors.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables; files on
 * that database run one at a time (see `vitest.config.mts`).
 */
const url = process.env.INGEST_TEST_DATABASE_URL;
const now = '2026-11-21T10:00:00Z';

describe.skipIf(!url)('silenced authors in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaSilencedAuthorsRepository;
  let batchId: string;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  const silence = (authorKey: string) =>
    repo.silence({
      authorKey,
      name: `Name of ${authorKey}`,
      reason: 'aggregator',
      origin: 'manual',
      evidence: null,
      createdBy: null,
    });

  /** A job of `kind` with no source yet; `id` lets a test fix the order. */
  async function job(
    kind: 'job' | 'post' = 'post',
    id = randomUUID(),
  ): Promise<string> {
    await db.orm.public.NormalizedJob.create({
      id,
      jobKey: `test:${id}`,
      kind,
      status: 'active',
      postingUrl: 'https://www.linkedin.com/posts/test',
      closed: false,
      fieldSources: {},
      firstSeenAt: new Date(now),
      lastSeenAt: new Date(now),
      normalizerVersion: 8,
    });
    return id;
  }

  /** Links a source to `jobId` whose normalized record is `record`. */
  async function source(jobId: string, record: unknown): Promise<void> {
    const item = await db.orm.public.RawItem.create({
      channel: 'LINKEDIN_POSTS',
      sourceKey: randomUUID(),
      kind: 'post',
      firstSeenAt: new Date(now),
      lastSeenAt: new Date(now),
    });
    const version = await db.orm.public.RawItemVersion.create({
      rawItemId: item.id,
      contentHash: randomUUID(),
      payload: {},
      firstBatchId: batchId,
      firstSeenAt: new Date(now),
      lastSeenAt: new Date(now),
    });
    const normalized = await db.orm.public.NormalizedVersion.create({
      rawVersionId: version.id,
      normalizerVersion: 8,
      status: 'valid',
      record: record as never,
      jobKey: `test:${jobId}`,
    });
    await db.orm.public.NormalizedJobSource.create({
      jobId,
      rawItemId: item.id,
      normalizedVersionId: normalized.id,
      linkedAt: new Date(now),
    });
  }

  const by = (key: string | null) => ({ post: { author: { key } } });

  /** What the exported predicate says about one job. */
  async function predicate(jobId: string): Promise<boolean> {
    const { raw } = db;
    const rows = await db.query(
      raw.sql`SELECT ${silencedPostJobSql(raw, 'j.id')} AS silenced
        FROM normalized_jobs j WHERE j.id = ${jobId}::uuid`
        .returnsRow({ silenced: 'pg/bool@1' })
        .build(),
    );
    return rows[0]?.silenced as boolean;
  }

  const held = () => repo.silencedPostJobIds({ before: null, limit: 100 });

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
    repo = new PrismaSilencedAuthorsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE silenced_authors, job_decisions, normalized_job_sources, normalized_jobs, companies, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
    const run = await db.orm.public.SearchSegmentRun.create({
      channel: 'LINKEDIN_POSTS',
      segmentKey: 'k',
      segmentHash: randomUUID(),
      queryIds: [],
      windowStart: new Date('2026-11-21T09:00:00Z'),
      windowEnd: new Date(now),
      startedAt: new Date(now),
      finishedAt: new Date(now),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd: null,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      error: null,
    });
    const batch = await db.orm.public.CollectionBatch.create({
      channel: 'LINKEDIN_POSTS',
      segmentRunId: run.id,
      storageKey: `posts/${run.id}.json`,
      formatVersion: 1,
      observedAt: new Date(now),
      itemCount: 0,
      actor: 'test',
      apifyRunId: null,
      status: 'pending',
    });
    batchId = batch.id;
  });

  it('silences a one-source post job by a silenced author', async () => {
    const id = await job();
    await source(id, by('profile:a'));
    expect(await predicate(id)).toBe(false);
    expect(await silence('profile:a')).toBe('silenced');
    expect(await predicate(id)).toBe(true);
    expect(await held()).toEqual([id]);
  });

  it('keeps a job live when another source has an author not silenced', async () => {
    const id = await job();
    await source(id, by('profile:a'));
    await source(id, by('company:b'));
    await silence('profile:a');
    expect(await predicate(id)).toBe(false);
    expect(await held()).toEqual([]);
    await silence('company:b');
    expect(await predicate(id)).toBe(true);
  });

  it('never counts a source with a null author key, or no post, as silenced', async () => {
    const nullKey = await job();
    await source(nullKey, by('profile:a'));
    await source(nullKey, by(null));
    const noPost = await job();
    await source(noPost, by('profile:a'));
    await source(noPost, { kind: 'post' });
    await silence('profile:a');
    expect(await predicate(nullKey)).toBe(false);
    expect(await predicate(noPost)).toBe(false);
    expect(await held()).toEqual([]);
  });

  it('never silences a job with no source, or a job that is not a post', async () => {
    const empty = await job();
    const listing = await job('job');
    await source(listing, by('profile:a'));
    await silence('profile:a');
    expect(await predicate(empty)).toBe(false);
    expect(await predicate(listing)).toBe(false);
    expect(await held()).toEqual([]);
  });

  it('makes the job live again on unsilence, with no clean-up', async () => {
    const id = await job();
    await source(id, by('profile:a'));
    await silence('profile:a');
    expect(await repo.unsilence('profile:a')).toBe(true);
    expect(await predicate(id)).toBe(false);
    expect(await held()).toEqual([]);
    expect(await repo.unsilence('profile:a')).toBe(false);
  });

  it("answers 'already' to a second silence, keeping the first entry", async () => {
    expect(await silence('profile:a')).toBe('silenced');
    expect(
      await repo.silence({
        authorKey: 'profile:a',
        name: 'Other',
        reason: 'other',
        origin: 'automatic',
        evidence: { posts: 10 },
        createdBy: null,
      }),
    ).toBe('already');
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      authorKey: 'profile:a',
      name: 'Name of profile:a',
      reason: 'aggregator',
      origin: 'manual',
      evidence: null,
      createdBy: null,
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('lists entries newest first, with evidence and who added them', async () => {
    const owner = randomUUID();
    await silence('profile:a');
    // createdAt has millisecond precision: let the clock move on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.silence({
      authorKey: 'company:b',
      name: null,
      reason: 'not hiring',
      origin: 'automatic',
      evidence: { posts: 12, days: 9 },
      createdBy: owner,
    });
    const rows = await repo.list();
    expect(rows.map((r) => r.authorKey)).toEqual(['company:b', 'profile:a']);
    expect(rows[0]).toMatchObject({
      name: null,
      evidence: { posts: 12, days: 9 },
      createdBy: owner,
      origin: 'automatic',
    });
  });

  it('rejects an origin other than manual or automatic', async () => {
    await expect(
      repo.silence({
        authorKey: 'profile:a',
        name: null,
        reason: 'x',
        origin: 'other' as 'manual',
        evidence: null,
        createdBy: null,
      }),
    ).rejects.toThrow();
  });

  it('pages held posts by job id, newest first', async () => {
    const ids: ReturnType<typeof randomUUID>[] = [
      '019a0000-0000-7000-8000-000000000001',
      '019a0000-0000-7000-8000-000000000002',
      '019a0000-0000-7000-8000-000000000003',
    ];
    for (const id of ids) {
      await job('post', id);
      await source(id, by('profile:a'));
    }
    await silence('profile:a');
    const first = await repo.silencedPostJobIds({ before: null, limit: 2 });
    expect(first).toEqual([ids[2], ids[1]]);
    const next = await repo.silencedPostJobIds({
      before: first.at(-1)!,
      limit: 2,
    });
    expect(next).toEqual([ids[0]]);
  });

  it('refuses a job id column that is not a plain column reference', () => {
    expect(() => silencedPostJobSql(db.raw, 'j.id; DROP TABLE x')).toThrow();
  });
});
