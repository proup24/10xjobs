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
} from 'src/modules/segments/repositories/segments.repository';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { ingestConfig } from '../config';
import { BatchFileReaderService } from '../services/batch-file-reader.service';
import { BatchItemWriterService } from '../services/batch-item-writer.service';
import { BatchIngestService } from '../services/batch.service';
import { RenormalizeService } from '../services/renormalize.service';
import type { BatchFile } from '../types';
import { contentHash, serializeBatchFile, sourceKey } from '../utils';
import ashbyFailed from '../utils/fixtures/ashby-failed.json';
import ashby from '../utils/fixtures/ashby.json';
import greenhouse from '../utils/fixtures/greenhouse.json';
import linkedinJob from '../utils/fixtures/linkedin-job.json';
import {
  PrismaRawStorageRepository,
  type SaveItemInput,
} from './raw.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Every
 * test on that database lives in this file, so they never run in parallel.
 */
const url = process.env.INGEST_TEST_DATABASE_URL;
const t1 = new Date('2026-10-31T10:00:00Z');
const t2 = new Date('2026-10-31T11:00:00Z');
const t3 = new Date('2026-10-31T12:00:00Z');
const job = (description: string) => ({
  id: '4012345678',
  url: 'https://www.linkedin.com/jobs/view/4012345678',
  descriptionHtml: description,
});

describe.skipIf(!url)('raw storage in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaRawStorageRepository;
  let q1: string;
  let q2: string;

  async function builder(): Promise<string> {
    const row = await db.orm.public.QuerySearchBuilder.create({
      channel: Channel.LINKEDIN_JOB_BOARD,
      location: 'worldwide',
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
    return row.id;
  }

  /** A pending batch row, its segment run, and optionally its stored file. */
  async function batch(channel = Channel.LINKEDIN_JOB_BOARD): Promise<string> {
    const run = await db.orm.public.SearchSegmentRun.create({
      channel,
      segmentKey: 'k',
      segmentHash: randomUUID(),
      queryIds: [q1, q2],
      windowStart: t1,
      windowEnd: t3,
      startedAt: t3,
      finishedAt: t3,
      status: 'succeeded',
      fetched: 0,
      costMicroUsd: null,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      error: null,
    });
    const row = await db.orm.public.CollectionBatch.create({
      channel,
      segmentRunId: run.id,
      storageKey: `${channel}/x/${run.id}.json`,
      formatVersion: 1,
      observedAt: t3,
      itemCount: 0,
      actor: 'test',
      apifyRunId: null,
      status: 'pending',
    });
    return row.id;
  }

  function input(
    batchId: string,
    payload: unknown,
    observedAt: Date,
    queryId: string | null = q1,
    channel = Channel.LINKEDIN_JOB_BOARD,
  ): SaveItemInput {
    const key = sourceKey(channel, payload);
    if (!('key' in key)) throw new Error(key.invalid);
    return {
      batchId,
      channel,
      kind: 'job',
      sourceKey: key.key,
      contentHash: contentHash(channel, payload),
      payload,
      queryId,
      rank: 1,
      observedAt,
    };
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
    repo = new PrismaRawStorageRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw
        .sql`TRUNCATE normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs, query_search_builder CASCADE`
        .affectedCount()
        .build(),
    );
    q1 = await builder();
    q2 = await builder();
  });

  it('stores a first sighting as an item, a version and a sighting', async () => {
    const b = await batch();
    expect(await repo.saveItem(input(b, job('a'), t1))).toMatchObject({
      newItem: true,
      newVersion: true,
    });
    const [item] = await db.orm.public.RawItem.all();
    const [version] = await db.orm.public.RawItemVersion.all();
    expect(item).toMatchObject({ sourceKey: 'id:4012345678', kind: 'job' });
    expect(item!.latestVersionId).toBe(version!.id);
    expect(version).toMatchObject({ firstBatchId: b, payload: job('a') });
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(1);
  });

  it('adds only a sighting for the same content in a later batch', async () => {
    await repo.saveItem(input(await batch(), job('a'), t1));
    const result = await repo.saveItem(input(await batch(), job('a'), t2));

    expect(result).toMatchObject({ newItem: false, newVersion: false });
    expect(await db.orm.public.RawItemVersion.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(2);
  });

  it('adds a version when the content changes, and points back at A after A → B → A', async () => {
    await repo.saveItem(input(await batch(), job('a'), t1));
    expect(
      await repo.saveItem(input(await batch(), job('b'), t2)),
    ).toMatchObject({
      newItem: false,
      newVersion: true,
    });
    await repo.saveItem(input(await batch(), job('a'), t3));

    const versions = await db.orm.public.RawItemVersion.all();
    const a = versions.find(
      (v) =>
        v.contentHash === contentHash(Channel.LINKEDIN_JOB_BOARD, job('a')),
    );
    const [item] = await db.orm.public.RawItem.all();
    expect(versions).toHaveLength(2);
    expect(item!.latestVersionId).toBe(a!.id);
    expect(a).toMatchObject({ firstSeenAt: t1, lastSeenAt: t3 });
  });

  it('writes nothing when the same item is saved again for the same batch and query', async () => {
    const b = await batch();
    await repo.saveItem(input(b, job('a'), t1));
    await repo.saveItem(input(b, job('a'), t1));
    await repo.saveItem(input(b, job('a'), t1, null));
    await repo.saveItem(input(b, job('a'), t1, null));

    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(2);
  });

  it('keeps one item and version, with a sighting per query, for a posting two queries found', async () => {
    const b = await batch();
    await repo.saveItem(input(b, job('a'), t1, q1));
    await repo.saveItem(input(b, job('a'), t1, q2));

    expect(await db.orm.public.RawItem.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemVersion.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(2);
  });

  it('stays free of duplicates under concurrent saves of the same item', async () => {
    const b1 = await batch();
    const b2 = await batch();
    await Promise.all([
      repo.saveItem(input(b1, job('a'), t1)),
      repo.saveItem(input(b2, job('a'), t2)),
      repo.saveItem(input(b1, job('a'), t1, q2)),
      repo.saveItem(input(b2, job('b'), t2, q2)),
    ]);

    expect(await db.orm.public.RawItem.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemVersion.all()).toHaveLength(2);
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(4);
  });

  it('keeps first and last seen correct when observations arrive out of order', async () => {
    await repo.saveItem(input(await batch(), job('a'), t2));
    await repo.saveItem(input(await batch(), job('a'), t3));
    await repo.saveItem(input(await batch(), job('a'), t1));

    const [item] = await db.orm.public.RawItem.all();
    expect(item).toMatchObject({ firstSeenAt: t1, lastSeenAt: t3 });
  });

  it('shares one raw item between a failed ATS fetch and the later fetched posting', async () => {
    await repo.saveItem({
      ...input(await batch(Channel.ASHBY), ashbyFailed, t1, q1, Channel.ASHBY),
    });
    await repo.saveItem({
      ...input(await batch(Channel.ASHBY), ashby, t2, q1, Channel.ASHBY),
    });

    expect(await db.orm.public.RawItem.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemVersion.all()).toHaveLength(2);
  });

  it('ingests a stored batch once; a redelivered message changes nothing', async () => {
    const storage = new MemoryStorageService();
    const service = new BatchIngestService(
      repo,
      new BatchFileReaderService(storage),
      new BatchItemWriterService(repo),
    );
    const id = await batch();
    const row = await db.orm.public.CollectionBatch.where({ id }).first();
    const file: BatchFile = {
      formatVersion: 1,
      batchId: id,
      channel: Channel.LINKEDIN_JOB_BOARD,
      segmentRunId: row!.segmentRunId,
      observedAt: t3.toISOString(),
      source: { actor: 'test', apifyRunId: null },
      queries: [],
      itemsByQuery: { [q1]: [{ rank: 1, payload: job('a') }] },
      unattributed: [],
    };
    await storage.put(
      ingestConfig.bucket,
      row!.storageKey,
      serializeBatchFile(file),
    );

    const report = await service.ingestBatch(id, { final: false });
    expect(await service.ingestBatch(id, { final: false })).toBeNull();

    const stored = await db.orm.public.CollectionBatch.where({ id }).first();
    expect(stored).toMatchObject({ status: 'ingested', report });
    expect(stored!.ingestedAt).toBeInstanceOf(Date);
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(1);
  });

  it('moves batches through attempts, failure, replay and the stale list', async () => {
    const id = await batch();
    await repo.recordAttemptFailure(id, 'reset', false);
    expect(
      await db.orm.public.CollectionBatch.where({ id }).first(),
    ).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'reset',
    });
    expect(
      await repo.listStalePending(new Date(Date.now() + 60_000), 10),
    ).toEqual([id]);
    expect(
      await repo.listStalePending(new Date(Date.now() - 60_000), 10),
    ).toEqual([]);

    await repo.recordAttemptFailure(id, 'reset again', true);
    expect((await repo.findBatch(id))!.status).toBe('failed');
    expect(await repo.resetToPending(id)).toBe(true);
    expect(await repo.findBatch(id)).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
    expect(await repo.resetToPending(id)).toBe(false);
  });

  describe('segment runs and batches', () => {
    let segments: PrismaSearchSegmentsRepository;
    let queryId: string;
    const until = new Date('2026-10-31T12:00:00Z');
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
      searchTotals: null,
      error: null,
    });
    const batch = (
      overrides: Partial<NewCollectionBatch> = {},
    ): NewCollectionBatch => ({
      id: randomUUID(),
      storageKey: 'ASHBY/2026-10-31/x.json',
      formatVersion: 1,
      observedAt: until,
      itemCount: 1,
      actor: 'apify/google-search-scraper',
      apifyRunId: 'run-1',
      ...overrides,
    });

    beforeEach(() => {
      segments = new PrismaSearchSegmentsRepository({ db } as DatabaseService);
      queryId = q1;
    });

    it('records the run, a pending batch and the cursors together', async () => {
      const r = run();
      const b = batch();
      await segments.recordCollectedRun(r, b, [queryId]);

      expect(
        await db.orm.public.SearchSegmentRun.where({ id: r.id }).first(),
      ).toMatchObject({
        status: 'succeeded',
      });
      expect(
        await db.orm.public.CollectionBatch.where({ id: b.id }).first(),
      ).toMatchObject({
        segmentRunId: r.id,
        channel: Channel.ASHBY,
        status: 'pending',
        attempts: 0,
      });
      expect(
        (await db.orm.public.QuerySearchBuilder.where({ id: queryId }).first())!
          .coveredUntil,
      ).toEqual(until);
    });

    it('writes nothing when the batch cannot be inserted', async () => {
      const r = run();
      const first = batch();
      await segments.recordCollectedRun(r, first, []);
      // Same batch id again: the insert fails, so neither run nor cursor may land.
      const second = run();
      await expect(
        segments.recordCollectedRun(second, batch({ id: first.id }), [queryId]),
      ).rejects.toThrow();

      expect(
        await db.orm.public.SearchSegmentRun.where({ id: second.id }).first(),
      ).toBeNull();
      expect(
        (await db.orm.public.QuerySearchBuilder.where({ id: queryId }).first())!
          .coveredUntil,
      ).toBeNull();
    });
  });

  describe('normalized jobs', () => {
    const day = 24 * 60 * 60 * 1000;
    const at = (days: number) => new Date(t1.getTime() + days * day);
    const sii =
      'https://sii.pl/en/job-ads/id/38247/?sii_source=10&utm_source=linkedin.com#apply-contact-form';
    const ashbyUrl = ashby.hit.url;
    const liJob = (
      id: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      ...linkedinJob,
      id,
      jobUrl: `https://www.linkedin.com/jobs/view/${id}`,
      applyType: 'EXTERNAL',
      applyUrl: sii,
      ...overrides,
    });
    const save = async (
      payload: Record<string, unknown>,
      observedAt: Date,
      channel = Channel.LINKEDIN_JOB_BOARD,
    ) =>
      repo.saveItem(
        input(await batch(channel), payload, observedAt, q1, channel),
      );
    const jobs = () => db.orm.public.NormalizedJob.all();
    const sources = () => db.orm.public.NormalizedJobSource.all();
    const markProcessed = () =>
      db.orm.public.NormalizedJob.where({ status: 'active' }).updateAll({
        processingStatus: 'processed',
      });
    const rawItemId = async (sourceKey: string) =>
      (await db.orm.public.RawItem.where({ sourceKey }).first())!.id;

    it('unifies LinkedIn copies of one ad into one pending new job', async () => {
      for (const [i, city] of ['Cracow', 'Poznań', 'Katowice'].entries())
        await save(liJob(`448394177${i}`, { location: city }), t1);

      const [only, ...rest] = await jobs();
      expect(rest).toHaveLength(0);
      expect(only).toMatchObject({
        jobKey:
          'url:https://sii.pl/en/job-ads/id/38247?sii_source=10|Senior Backend Engineer',
        status: 'active',
        processingStatus: 'pending',
        processingReason: 'new',
        processingRequestedAt: t1,
      });
      expect(await sources()).toHaveLength(3);
    });

    it('unifies a LinkedIn job with its Ashby posting, the ATS winning', async () => {
      await save(
        liJob('4483900001', {
          applyUrl: `${ashbyUrl}/application`,
          location: 'United States',
        }),
        t1,
      );
      await save(ashby, t2, Channel.ASHBY);

      const [only, ...rest] = await jobs();
      expect(rest).toHaveLength(0);
      expect(only).toMatchObject({
        location: ashby.posting.locationName,
        companyName: linkedinJob.companyName,
        title: ashby.posting.title,
      });
      expect((only!.fieldSources as Record<string, string>).location).toBe(
        await rawItemId(`posting:acme/${ashby.posting.id}`),
      );
    });

    it('updates a processed job for a new source without sending it back', async () => {
      await save(liJob('4483900001', { applyUrl: ashbyUrl }), t1);
      await markProcessed();
      const result = await save(ashby, t2, Channel.ASHBY);

      expect(result.job).toMatchObject({
        created: false,
        reopened: false,
        pending: false,
      });
      const [only] = await jobs();
      expect(only).toMatchObject({
        processingStatus: 'processed',
        location: ashby.posting.locationName,
      });
    });

    it('reopens a job seen again after three weeks unseen, not before', async () => {
      await save(liJob('4483900001'), t1);
      await markProcessed();
      await save(liJob('4483900001'), at(20));
      expect((await jobs())[0]!.processingStatus).toBe('processed');

      const result = await save(liJob('4483900001'), at(41));
      expect(result.job).toMatchObject({ reopened: true, pending: true });
      expect((await jobs())[0]).toMatchObject({
        processingStatus: 'pending',
        processingReason: 'reopened',
        processingRequestedAt: at(41),
      });
    });

    it('moves an item whose apply URL appears later, merging its old job', async () => {
      await save(
        liJob('4483941772', { applyType: 'EASY_APPLY', applyUrl: '' }),
        t1,
      );
      await markProcessed();
      const result = await save(liJob('4483941772'), t2);

      expect(result.job).toMatchObject({ created: false });
      const all = await jobs();
      const old = all.find((j) => j.jobKey === 'linkedin-job:4483941772')!;
      const moved = all.find((j) => j.jobKey.startsWith('url:'))!;
      expect(old).toMatchObject({ status: 'merged', mergedIntoId: moved.id });
      expect(moved).toMatchObject({
        status: 'active',
        processingStatus: 'processed',
      });
      expect(await sources()).toEqual([
        expect.objectContaining({ jobId: moved.id }),
      ]);
    });

    it('re-merges the old job when a moved item leaves other sources behind', async () => {
      await save(liJob('4483900001', { location: 'Stays' }), t1);
      await save(liJob('4483900002', { location: 'Leaves' }), t2);
      const before = (await jobs())[0]!;
      expect(before.location).toBe('Leaves');

      await save(
        liJob('4483900002', {
          location: 'Leaves',
          applyUrl: 'https://acme.com/jobs/99999',
        }),
        t3,
      );
      const after = await db.orm.public.NormalizedJob.where({
        id: before.id,
      }).first();
      const stays = await rawItemId('id:4483900001');
      expect(after).toMatchObject({ status: 'active', location: 'Stays' });
      expect(
        Object.values(after!.fieldSources as Record<string, string>).every(
          (id) => id === stays,
        ),
      ).toBe(true);
      const moved = await db.orm.public.NormalizedJob.where({
        jobKey: 'url:https://acme.com/jobs/99999|Senior Backend Engineer',
      }).first();
      expect(moved).toMatchObject({
        processingStatus: 'pending',
        processingReason: 'new',
      });
    });

    it('keeps different roles on one listing page as separate jobs', async () => {
      const listing =
        'https://recruiting.paylocity.com/Recruiting/Jobs/All/7a3e1b2c-0000-4000-8000-000000000001';
      await save(
        liJob('4483900001', { applyUrl: listing, title: 'Backend Engineer' }),
        t1,
      );
      await save(
        liJob('4483900002', { applyUrl: listing, title: 'Frontend Engineer' }),
        t1,
      );
      expect((await jobs()).map((j) => j.title).sort()).toEqual([
        'Backend Engineer',
        'Frontend Engineer',
      ]);
    });

    it('keeps an item on its apply-URL job when a rescrape drops the URL', async () => {
      await save(liJob('4485989297'), t1);
      const result = await save(liJob('4485989297', { applyUrl: '' }), t2);

      expect(result.job).toMatchObject({ created: false });
      const all = await jobs();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        status: 'active',
        jobKey: `url:https://sii.pl/en/job-ads/id/38247?sii_source=10|Senior Backend Engineer`,
      });
    });

    it('rebuilds the apply-URL key of an item whose latest scrape dropped the URL', async () => {
      await save(liJob('4485989297'), t1);
      await save(liJob('4485989297', { applyUrl: '' }), t2);
      await db.execute(
        db.raw
          .sql`TRUNCATE normalized_job_sources, normalized_jobs, normalized_versions CASCADE`
          .affectedCount()
          .build(),
      );
      await new RenormalizeService({ db } as DatabaseService).run();
      expect((await jobs()).map((j) => j.jobKey)).toEqual([
        `url:https://sii.pl/en/job-ads/id/38247?sii_source=10|Senior Backend Engineer`,
      ]);
    });

    it('writes nothing new when a batch is replayed', async () => {
      const b = await batch();
      await repo.saveItem(input(b, liJob('4483900001'), t1));
      const once = { jobs: await jobs(), sources: await sources() };
      const again = await repo.saveItem(input(b, liJob('4483900001'), t1));

      // Still waiting for Process: the replay nudges it again (harmless).
      expect(again.job).toMatchObject({
        created: false,
        reopened: false,
        pending: true,
      });
      expect(await jobs()).toEqual(
        once.jobs.map((j) => ({ ...j, updatedAt: expect.any(Date) })),
      );
      expect(await sources()).toEqual(once.sources);
    });

    it('ignores an older observation replayed after a newer one', async () => {
      await save(liJob('4483941772'), at(30));
      await markProcessed();
      await save(
        liJob('4483941772', { applyType: 'EASY_APPLY', applyUrl: '' }),
        t1,
      );

      const all = await jobs();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        jobKey:
          'url:https://sii.pl/en/job-ads/id/38247?sii_source=10|Senior Backend Engineer',
        processingStatus: 'processed',
      });
    });

    it('creates one job when items with the same apply URL are saved concurrently', async () => {
      const [b1, b2] = [await batch(), await batch()];
      await Promise.all([
        repo.saveItem(input(b1, liJob('4483900001'), t1)),
        repo.saveItem(input(b2, liJob('4483900002'), t1)),
      ]);
      expect(await jobs()).toHaveLength(1);
      expect(await sources()).toHaveLength(2);
    });

    it('keeps raw rows but makes no job when normalization rejects the item', async () => {
      const result = await save(
        liJob('4483900001', {
          title: '',
          description: '',
          descriptionHtml: '',
        }),
        t1,
      );
      expect(result).toMatchObject({
        newItem: true,
        job: { invalid: expect.stringMatching(/^normalize:/) },
      });
      expect(await db.orm.public.RawItem.all()).toHaveLength(1);
      expect(await jobs()).toHaveLength(0);
      expect(await db.orm.public.NormalizedVersion.all()).toEqual([
        expect.objectContaining({ status: 'invalid', record: null }),
      ]);
    });

    it('keeps a job for a salary too large for its column, without the salary', async () => {
      const result = await save(
        liJob('4483900001', {
          salary: 'VND 3,000,000,000/yr',
          salaryMin: 3e9,
          salaryMax: 4e9,
          salaryCurrency: 'VND',
          salaryPeriod: 'yr',
        }),
        t1,
      );
      expect(result).toMatchObject({
        newItem: true,
        job: { created: true, pending: true },
      });
      expect((await jobs())[0]).toMatchObject({
        salaryText: 'VND 3,000,000,000/yr',
        salaryMin: null,
        salaryMax: null,
      });
    });

    it('stores the raw item and its job when a description holds an unpaired surrogate entity', async () => {
      const result = await save(
        {
          ...greenhouse,
          posting: {
            ...greenhouse.posting,
            content: '&lt;p&gt;bad &amp;#xD800; char&lt;/p&gt;&#xD800;',
          },
        },
        t1,
        Channel.GREEN_HOUSE,
      );
      expect(result).toMatchObject({ newItem: true, job: { created: true } });
      expect(await db.orm.public.RawItem.all()).toHaveLength(1);
    });

    it('never leaves an active job without sources when a rebuild races a move', async () => {
      for (let round = 0; round < 5; round++) {
        const id = `44839500${round}`;
        await save(liJob(id, { applyType: 'EASY_APPLY', applyUrl: '' }), t1);
        await Promise.all([
          save(
            liJob(id, { applyUrl: `https://acme.com/jobs/7777${round}` }),
            t2,
          ),
          new RenormalizeService({ db } as DatabaseService).run(),
        ]);
      }
      const linked = new Set((await sources()).map((s) => s.jobId));
      const ghosts = (await jobs()).filter(
        (j) => j.status === 'active' && !linked.has(j.id),
      );
      expect(ghosts).toEqual([]);
      for (let round = 0; round < 5; round++) {
        const link = await db.orm.public.NormalizedJobSource.where({
          rawItemId: await rawItemId(`id:44839500${round}`),
        }).first();
        const job = await db.orm.public.NormalizedJob.where({
          id: link!.jobId,
        }).first();
        expect(job!.jobKey).toBe(
          `url:https://acme.com/jobs/7777${round}|Senior Backend Engineer`,
        );
      }
    });

    describe('rebuild', () => {
      const wipe = () =>
        db.execute(
          db.raw
            .sql`TRUNCATE normalized_job_sources, normalized_jobs, normalized_versions CASCADE`
            .affectedCount()
            .build(),
        );
      /** Job rows without ids, timestamps, sources and processing columns. */
      const fields = async () => {
        const skip = new Set([
          'id',
          'createdAt',
          'updatedAt',
          'fieldSources',
          'processingStatus',
          'processingReason',
          'processingRequestedAt',
        ]);
        return (await jobs())
          .map((j) =>
            Object.fromEntries(
              Object.entries(j).filter(([key]) => !skip.has(key)),
            ),
          )
          .sort((a, b) => String(a.jobKey).localeCompare(String(b.jobKey)));
      };
      const rebuild = () =>
        new RenormalizeService({ db } as DatabaseService).run();

      beforeEach(async () => {
        await save(liJob('4483900001'), t1);
        await save(liJob('4483900002', { location: 'Poznań' }), t2);
        await save(liJob('4483900003', { applyType: 'EASY_APPLY' }), t2);
        await save(ashby, t3, Channel.ASHBY);
      });

      it('rebuilds the same jobs from raw storage without sending any to Process', async () => {
        const before = await fields();
        const linksBefore = (await sources()).length;
        await wipe();

        expect(await rebuild()).toEqual({ items: 4, invalid: 0, jobs: 3 });
        expect(await fields()).toEqual(before);
        expect(await sources()).toHaveLength(linksBefore);
        expect((await jobs()).every((j) => j.processingStatus === null)).toBe(
          true,
        );
      });

      it('changes nothing when run twice, and keeps processing status', async () => {
        await markProcessed();
        await rebuild();
        const once = await fields();
        await rebuild();
        expect(await fields()).toEqual(once);
        expect(
          (await jobs()).every((j) => j.processingStatus === 'processed'),
        ).toBe(true);
      });
    });
  });
});
