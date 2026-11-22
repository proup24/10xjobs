import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { NORMALIZER_VERSION } from 'src/modules/ingest/normalize/record';
import { PrismaPrepareReviewRepository } from './prepare-review.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables; files on
 * that database run one at a time (see `vitest.config.mts`).
 */
const url = process.env.INGEST_TEST_DATABASE_URL;
const now = '2026-11-21T10:00:00Z';

describe.skipIf(!url)('prepare review in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaPrepareReviewRepository;
  let batchId: string;
  let lastNormalizedId: string;

  async function truncate(): Promise<void> {
    await db.execute(
      db.raw
        .sql`TRUNCATE silenced_authors, job_decisions, normalized_job_sources, normalized_jobs, companies, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`
        .affectedCount()
        .build(),
    );
  }

  /** A post item whose latest version normalized (at `version`) as `status`. */
  async function item(
    lastSeenAt: string,
    status: 'valid' | 'invalid',
    reason: string | null,
    version = NORMALIZER_VERSION,
    kind: 'job' | 'post' = 'post',
    record?: unknown,
  ): Promise<string> {
    const raw = await db.orm.public.RawItem.create({
      channel: 'LINKEDIN_POSTS',
      sourceKey: randomUUID(),
      kind,
      firstSeenAt: new Date(now),
      lastSeenAt: new Date(lastSeenAt),
    });
    const v = await db.orm.public.RawItemVersion.create({
      rawItemId: raw.id,
      contentHash: randomUUID(),
      payload: {
        id: raw.id,
        author: { type: 'profile', publicIdentifier: 'Jane' },
      },
      firstBatchId: batchId,
      firstSeenAt: new Date(now),
      lastSeenAt: new Date(lastSeenAt),
    });
    await db.execute(
      db.raw
        .sql`UPDATE raw_items SET "latestVersionId" = ${v.id}::uuid WHERE id = ${raw.id}::uuid`
        .affectedCount()
        .build(),
    );
    const normalized = await db.orm.public.NormalizedVersion.create({
      rawVersionId: v.id,
      normalizerVersion: version,
      status,
      reason,
      ...(status === 'valid'
        ? { record: (record ?? {}) as never, jobKey: `k:${raw.id}` }
        : {}),
    });
    lastNormalizedId = normalized.id;
    return raw.id;
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
    repo = new PrismaPrepareReviewRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await truncate();
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

  it('lists only current invalid post versions, newest first, any reason', async () => {
    const a = await item('2026-11-21T10:00:03Z', 'invalid', 'prepare: no-text');
    const b = await item(
      '2026-11-21T10:00:02Z',
      'invalid',
      'normalize: post has no id or link',
    );
    await item('2026-11-21T10:00:05Z', 'valid', null);
    await item(
      '2026-11-21T10:00:06Z',
      'invalid',
      'prepare: no-text',
      NORMALIZER_VERSION - 1,
    );
    await item(
      '2026-11-21T10:00:07Z',
      'invalid',
      'normalize: x',
      NORMALIZER_VERSION,
      'job',
    );
    const rows = await repo.drops({ rule: null, before: null, limit: 10 });
    expect(rows.map((r) => r.rawItemId)).toEqual([a, b]);
    expect(rows[0]).toMatchObject({ reason: 'prepare: no-text' });
    expect(rows[0]!.payload).toMatchObject({ id: a });
  });

  it('filters by rule name, exactly, with or without a match', async () => {
    const a = await item('2026-11-21T10:00:03Z', 'invalid', 'prepare: no-text');
    const b = await item(
      '2026-11-21T10:00:02Z',
      'invalid',
      'prepare: agency: "we place: devs"',
    );
    await item('2026-11-21T10:00:01Z', 'invalid', 'prepare: agency-extra: "x"');
    await item('2026-11-21T10:00:00Z', 'invalid', 'normalize: agency');
    const ids = async (rule: string) =>
      (await repo.drops({ rule, before: null, limit: 10 })).map(
        (r) => r.rawItemId,
      );
    expect(await ids('no-text')).toEqual([a]);
    expect(await ids('agency')).toEqual([b]);
    expect(await ids('50%')).toEqual([]);
  });

  it('pages by lastSeenAt then id, with no gaps on a tie', async () => {
    const same = '2026-11-21T10:00:05.123Z';
    const ids = [
      await item(same, 'invalid', 'prepare: no-text'),
      await item(same, 'invalid', 'prepare: no-text'),
      await item('2026-11-21T10:00:01Z', 'invalid', 'prepare: no-text'),
    ];
    const all = await repo.drops({ rule: null, before: null, limit: 10 });
    expect(all.map((r) => r.rawItemId).slice(0, 2)).toEqual(
      [ids[0]!, ids[1]!].sort().reverse(),
    );
    expect(all[2]!.rawItemId).toBe(ids[2]);
    const first = await repo.drops({ rule: null, before: null, limit: 2 });
    const last = first[1]!;
    const second = await repo.drops({
      rule: null,
      before: { lastSeenAt: last.lastSeenAt.toISOString(), id: last.rawItemId },
      limit: 2,
    });
    expect([...first, ...second].map((r) => r.rawItemId)).toEqual(
      all.map((r) => r.rawItemId),
    );
  });

  it('reads held posts with a source post record, in id order', async () => {
    const insert = async (id: string, post: unknown) => {
      await db.orm.public.NormalizedJob.create({
        id,
        jobKey: `test:${id}`,
        kind: 'post',
        status: 'active',
        postingUrl: `https://www.linkedin.com/posts/${id}`,
        closed: false,
        fieldSources: {},
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        normalizerVersion: 8,
      });
      if (post === undefined) return;
      const rawId = await item(now, 'valid', null, NORMALIZER_VERSION, 'post', {
        post,
      });
      await db.orm.public.NormalizedJobSource.create({
        jobId: id,
        rawItemId: rawId,
        normalizedVersionId: lastNormalizedId,
        linkedAt: new Date(now),
      });
    };
    const a = '00000000-0000-7000-8000-000000000001';
    const b = '00000000-0000-7000-8000-000000000002';
    await insert(a, {
      author: { key: 'profile:a' },
      postedAt: '2026-11-20T00:00:00.000Z',
    });
    await insert(b, undefined);
    expect(await repo.heldPosts([])).toEqual([]);
    expect(await repo.heldPosts([a, b])).toEqual([
      {
        jobId: b,
        postingUrl: `https://www.linkedin.com/posts/${b}`,
        post: null,
      },
      {
        jobId: a,
        postingUrl: `https://www.linkedin.com/posts/${a}`,
        post: {
          author: { key: 'profile:a' },
          postedAt: '2026-11-20T00:00:00.000Z',
        },
      },
    ]);
  });

  describe('verdicts', () => {
    const author = {
      key: 'profile:jane',
      name: 'Jane Doe',
      profileUrl: null,
      headline: 'Founder',
      type: 'person',
    };
    const source = {
      id: 'p1',
      url: 'https://www.linkedin.com/posts/p1',
      author,
      text: 'join my group',
      truncated: false,
      attachedUrls: [],
      postedAt: '2026-11-21T08:00:00.000Z',
      original: null,
      links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
    };

    async function extraction(
      jobId: string,
      createdAt: string,
      over: {
        docType?: string;
        verdict?: string | null;
        reason?: string | null;
        quote?: string;
      } = {},
    ): Promise<string> {
      const row = await db.orm.public.JobExtraction.create({
        jobId,
        inputHash: randomUUID(),
        schemaVersion: 1,
        promptHash: 'p',
        extractionModel: 'm',
        data: { verdict: { quote: over.quote ?? 'Join my group' } },
        needsReview: false,
        docType: over.docType ?? 'post',
        verdict: over.verdict === undefined ? 'junk' : over.verdict,
        verdictReason: over.reason === undefined ? 'funnel' : over.reason,
        verdictConfidence: 'sure',
        worldwide: false,
        regionCodes: [],
        countryCodes: [],
        cityIds: [],
        techTags: [],
        mainStackTags: [],
        costUsd: 0,
        createdAt: new Date(createdAt),
      } as never);
      return (row as { id: string }).id;
    }

    /** A post job whose current extraction is the last one made. */
    async function post(
      n: number,
      extractions: Parameters<typeof extraction>[2][],
      at = `2026-11-22T09:00:0${n}.000Z`,
      kind: 'post' | 'job' = 'post',
    ): Promise<string> {
      const id = `00000000-0000-7000-8000-00000000000${n}`;
      await db.orm.public.NormalizedJob.create({
        id,
        jobKey: `test:${id}`,
        kind,
        status: 'active',
        postingUrl: `https://www.linkedin.com/posts/${n}`,
        closed: false,
        fieldSources: {},
        postSources: { sources: [source] },
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        normalizerVersion: 8,
      } as never);
      let current = '';
      for (const over of extractions) current = await extraction(id, at, over);
      await db.execute(
        db.raw
          .sql`UPDATE normalized_jobs SET "currentExtractionId" = ${current}::uuid WHERE id = ${id}::uuid`
          .affectedCount()
          .build(),
      );
      return id;
    }

    const page = (
      over: Partial<Parameters<PrismaPrepareReviewRepository['verdicts']>[0]>,
    ) =>
      repo.verdicts({
        verdict: null,
        reason: null,
        before: null,
        limit: 10,
        ...over,
      });

    it('lists current junk and not-hiring post extractions, newest first', async () => {
      const junk = await post(1, [{}]);
      const notHiring = await post(2, [
        {
          verdict: 'not_hiring',
          reason: 'open_to_work',
          quote: 'Open to work',
        },
      ]);
      await post(3, [{ verdict: 'hiring', reason: 'hiring' }]);
      // A junk extraction superseded by a hiring one does not list.
      await post(4, [{}, { verdict: 'hiring', reason: 'hiring' }]);
      // A listing extraction on a post job does not list.
      await post(5, [{ docType: 'listing', verdict: null, reason: null }]);
      // A listing job never lists, whatever its row says.
      await post(6, [{}], undefined, 'job');
      const rows = await page({});
      expect(rows.map((r) => r.jobId)).toEqual([notHiring, junk]);
      expect(rows[1]).toEqual({
        jobId: junk,
        postingUrl: 'https://www.linkedin.com/posts/1',
        verdict: 'junk',
        reason: 'funnel',
        confidence: 'sure',
        quote: 'Join my group',
        source,
        extractedAt: new Date('2026-11-22T09:00:01.000Z'),
      });
      expect(rows[0]).toMatchObject({
        reason: 'open_to_work',
        quote: 'Open to work',
      });
    });

    it('filters by verdict and reason', async () => {
      const funnel = await post(1, [{}]);
      const group = await post(2, [{ reason: 'messaging_group' }]);
      const other = await post(3, [{ verdict: 'not_hiring', reason: 'other' }]);
      const ids = async (o: Parameters<typeof page>[0]) =>
        (await page(o)).map((r) => r.jobId);
      expect(await ids({ verdict: 'junk' })).toEqual([group, funnel]);
      expect(await ids({ verdict: 'not_hiring' })).toEqual([other]);
      expect(await ids({ reason: 'funnel' })).toEqual([funnel]);
      expect(await ids({ verdict: 'junk', reason: 'other' })).toEqual([]);
    });

    it('pages by extraction time then job id, with no gaps on a tie', async () => {
      const same = '2026-11-22T09:00:05.123Z';
      await post(1, [{}], same);
      await post(2, [{}], same);
      await post(3, [{}], '2026-11-22T09:00:01.000Z');
      const all = await page({});
      expect(all).toHaveLength(3);
      const first = await page({ limit: 2 });
      const last = first[1]!;
      const second = await page({
        limit: 2,
        before: { lastSeenAt: last.extractedAt.toISOString(), id: last.jobId },
      });
      expect([...first, ...second].map((r) => r.jobId)).toEqual(
        all.map((r) => r.jobId),
      );
    });
  });
});
