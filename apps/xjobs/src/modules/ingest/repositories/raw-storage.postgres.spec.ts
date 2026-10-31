import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  createDatabaseClient,
  type DatabaseClient,
} from 'src/database/connection.source';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { ingestConfig } from '../config';
import { BatchIngestService } from '../services/batch-ingest.service';
import type { BatchFile } from '../types';
import { contentHash, serializeBatchFile, sourceKey } from '../utils';
import ashbyFailed from '../utils/fixtures/ashby-failed.json';
import ashby from '../utils/fixtures/ashby.json';
import {
  PrismaRawStorageRepository,
  type SaveItemInput,
} from './raw-storage.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
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
        .sql`TRUNCATE raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs, query_search_builder CASCADE`
        .affectedCount()
        .build(),
    );
    q1 = await builder();
    q2 = await builder();
  });

  it('stores a first sighting as an item, a version and a sighting', async () => {
    const b = await batch();
    expect(await repo.saveItem(input(b, job('a'), t1))).toEqual({
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

    expect(result).toEqual({ newItem: false, newVersion: false });
    expect(await db.orm.public.RawItemVersion.all()).toHaveLength(1);
    expect(await db.orm.public.RawItemSighting.all()).toHaveLength(2);
  });

  it('adds a version when the content changes, and points back at A after A → B → A', async () => {
    await repo.saveItem(input(await batch(), job('a'), t1));
    expect(await repo.saveItem(input(await batch(), job('b'), t2))).toEqual({
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
    const service = new BatchIngestService(repo, storage);
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
      serializeBatchFile(file));

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
});
