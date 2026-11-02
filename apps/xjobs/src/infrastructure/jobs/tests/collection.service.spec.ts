import { Logger } from '@nestjs/common';
import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import type {
  RawCollectedItem,
  SegmentResult,
  SegmentSearch,
} from 'src/modules/collectors';
import { ingestConfig, parseBatchFile } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { segmentHash } from 'src/modules/segments';
import { FakeSearchSegmentsRepository } from 'src/modules/segments/testing/fakes';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { CollectionService, channelJobsConfig } from '../steps/collect';
import type { IngestQueue } from '../steps/ingest/queue.service';

let n = 0;
const builder = (overrides: Partial<QuerySearchBuilderRow> = {}) =>
  ({
    id: `qs-${String(++n).padStart(3, '0')}`,
    hash: `h-${String(n).padStart(3, '0')}`,
    channel: Channel.ASHBY,
    domain: SkillDomain.backend,
    type: Arrangement.remote,
    location: 'emea',
    keyword: `kw ${n}`,
    params: { remote: true },
    coveredUntil: null,
    ...overrides,
  }) as unknown as QuerySearchBuilderRow;
const builders = (
  count: number,
  overrides: Partial<QuerySearchBuilderRow> = {},
) => Array.from({ length: count }, () => builder(overrides));

const item = (n: number) => ({ rank: n, payload: { id: `j${n}` } });

/** One item per member unless `perMember` says otherwise. */
const resultFor = (
  segment: SegmentSearch,
  perMember: (id: string) => RawCollectedItem[] = () => [item(1)],
  extra: Partial<SegmentResult> = {},
): SegmentResult => ({
  itemsByQuery: new Map(segment.queries.map((q) => [q.id, perMember(q.id)])),
  unattributed: [{ rank: null, payload: { id: 'stray' } }],
  fetched: segment.queries.length,
  costUsd: 0.1,
  capped: false,
  truncatedQueryIds: [],
  source: { actor: 'apify/google-search-scraper', apifyRunId: 'run-1' },
  ...extra,
});

function setup(
  rows: QuerySearchBuilderRow[],
  collect: (segment: SegmentSearch) => Promise<SegmentResult> = async (s) =>
    resultFor(s),
  channel: Channel = Channel.ASHBY,
) {
  const queries = { listActive: vi.fn(async () => rows) };
  const collectors = Object.fromEntries(
    Object.values(Channel).map((value) => [
      value,
      {
        collect: vi.fn((segment: SegmentSearch, _config: unknown) =>
          collect(segment),
        ),
      },
    ]),
  );
  const collector = collectors[channel];
  const segments = new FakeSearchSegmentsRepository();
  for (const row of rows)
    if (row.coveredUntil) segments.cursors.set(row.id, row.coveredUntil);
  const storage = new MemoryStorageService();
  const order: string[] = [];
  const put = storage.put.bind(storage);
  vi.spyOn(storage, 'put').mockImplementation(async (...args) => {
    order.push('put');
    return put(...args);
  });
  const recordCollectedRun = segments.recordCollectedRun.bind(segments);
  vi.spyOn(segments, 'recordCollectedRun').mockImplementation(
    async (...args) => {
      order.push('record');
      return recordCollectedRun(...args);
    },
  );
  const ingestQueue = {
    enqueue: vi.fn(async (_batchId: string) => {
      order.push('enqueue');
    }),
  };
  const collection = new CollectionService(
    collectors[Channel.ASHBY] as never,
    collectors[Channel.GREEN_HOUSE] as never,
    collectors[Channel.LINKEDIN_JOB_BOARD] as never,
    collectors[Channel.LINKEDIN_POSTS] as never,
    queries as unknown as QuerySearchService,
    segments,
    storage,
    ingestQueue as unknown as IngestQueue,
  );
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return {
    collection,
    collectors,
    queries,
    collector,
    segments,
    storage,
    ingestQueue,
    order,
    warn,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('channel selection', () => {
  it.each(Object.values(Channel))(
    'collects %s with its matching collector and limits',
    async (channel) => {
      const { collection, collectors, queries } = setup(
        builders(1, { channel }),
        undefined,
        channel,
      );
      const summary = await collection.collect(channel);
      expect(summary).toMatchObject({ channel, batches: 1, segmentsFailed: 0 });
      expect(queries.listActive).toHaveBeenCalledWith(channel);
      for (const other of Object.values(Channel)) {
        if (other === channel) {
          expect(collectors[other].collect).toHaveBeenCalledWith(
            expect.objectContaining({ channel }),
            channelJobsConfig[channel].run,
          );
        } else expect(collectors[other].collect).not.toHaveBeenCalled();
      }
    },
  );
});

describe('CollectionService.collect', () => {
  it('board discovery reads up to 10 Google pages', () => {
    expect(channelJobsConfig[Channel.ASHBY].run.maxPagesPerQuery).toBe(10);
    expect(channelJobsConfig[Channel.GREEN_HOUSE].run.maxPagesPerQuery).toBe(
      10,
    );
  });

  it('runs the collector once per segment of up to 10 builders', async () => {
    const rows = builders(12);
    const { collection, queries, collector } = setup(rows);
    const summary = await collection.collect(Channel.ASHBY);

    expect(queries.listActive).toHaveBeenCalledWith(Channel.ASHBY);
    expect(collector.collect).toHaveBeenCalledTimes(2);
    const [first, second] = collector.collect.mock.calls.map(([s]) => s);
    expect(first.queries.map((q) => q.id)).toEqual(
      rows.slice(0, 10).map((r) => r.id),
    );
    expect(second.queries.map((q) => q.id)).toEqual(
      rows.slice(10).map((r) => r.id),
    );
    expect(first.queries[0]).toEqual({
      id: rows[0].id,
      keyword: rows[0].keyword,
      params: { remote: true },
    });
    expect(first.until.getTime() - first.since.getTime()).toBe(
      channelJobsConfig[Channel.ASHBY].window.initialHours * 3_600_000,
    );
    expect(collector.collect.mock.calls[0][1]).toBe(
      channelJobsConfig[Channel.ASHBY].run,
    );
    expect(summary).toMatchObject({
      builders: 12,
      segments: 2,
      segmentsFailed: 0,
    });
  });

  it('stores the untouched results, then records run, batch and cursors, then enqueues', async () => {
    const rows = builders(2);
    const { collection, segments, storage, ingestQueue, order } = setup(
      rows,
      async (s) =>
        resultFor(s, (id) => (id === rows[0].id ? [item(1), item(2)] : [])),
    );
    const summary = await collection.collect(Channel.ASHBY);

    expect(order).toEqual(['put', 'record', 'enqueue']);
    const [collected] = segments.collected;
    const { run, batch } = collected!;
    expect(batch).toMatchObject({
      formatVersion: 1,
      itemCount: 3,
      actor: 'apify/google-search-scraper',
      apifyRunId: 'run-1',
      observedAt: run.windowEnd,
    });
    expect(batch.storageKey).toBe(
      `ASHBY/${run.windowEnd.toISOString().slice(0, 10)}/${run.id}.json`,
    );
    const file = parseBatchFile(
      await storage.get(ingestConfig.bucket, batch.storageKey),
    );
    expect(file).toMatchObject({
      batchId: batch.id,
      segmentRunId: run.id,
      channel: Channel.ASHBY,
      observedAt: run.windowEnd.toISOString(),
      source: { actor: 'apify/google-search-scraper', apifyRunId: 'run-1' },
      itemsByQuery: { [rows[0].id]: [item(1), item(2)], [rows[1].id]: [] },
      unattributed: [{ rank: null, payload: { id: 'stray' } }],
    });
    expect(file.queries.map((q) => q.id)).toEqual(rows.map((r) => r.id));
    expect(run.perQuery).toEqual({
      [rows[0].id]: { returned: 2 },
      [rows[1].id]: { returned: 0 },
    });
    expect(ingestQueue.enqueue).toHaveBeenCalledWith(batch.id);
    expect([...segments.cursors.keys()].sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
    expect(summary).toMatchObject({ batches: 1, collected: 3 });
    expect(summary).not.toHaveProperty('inserted');
  });

  it('records the search totals a run reports with its segment run', async () => {
    const rows = builders(2);
    const totals = { anything: [1, 2] };
    const { collection, segments } = setup(rows, async (s) =>
      resultFor(s, undefined, { searchTotals: totals }),
    );
    await collection.collect(Channel.ASHBY);
    expect(segments.collected[0]!.run.searchTotals).toEqual(totals);
  });

  it('records null totals when the collector reports none', async () => {
    const { collection, segments } = setup(builders(1));
    await collection.collect(Channel.ASHBY);
    expect(segments.collected[0]!.run.searchTotals).toBeNull();
  });

  it('keeps cursors and records a failed run when the batch cannot be stored', async () => {
    const { collection, segments, storage, ingestQueue } = setup(builders(2));
    storage.failNextPut = true;

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow(/ASHBY/);
    expect(segments.collected).toEqual([]);
    expect(segments.runs[0]).toMatchObject({ status: 'failed' });
    expect(segments.runs[0].error).toContain('storage unavailable');
    expect(segments.cursors.size).toBe(0);
    expect(ingestQueue.enqueue).not.toHaveBeenCalled();
  });

  it('keeps cursors when recording the run and batch fails', async () => {
    const { collection, segments, ingestQueue } = setup(builders(2));
    vi.spyOn(segments, 'recordCollectedRun').mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow(/ASHBY/);
    expect(segments.runs[0]).toMatchObject({ status: 'failed' });
    expect(segments.runs[0].error).toContain('db down');
    expect(segments.cursors.size).toBe(0);
    expect(ingestQueue.enqueue).not.toHaveBeenCalled();
  });

  it('writes no file when the collector fails', async () => {
    const { collection, storage } = setup(builders(1), async () => {
      throw new Error('Apify run FAILED');
    });
    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow();
    expect(storage.keys(ingestConfig.bucket)).toEqual([]);
  });

  it('counts a segment as collected when only the enqueue fails', async () => {
    const { collection, segments, ingestQueue, warn } = setup(builders(1));
    ingestQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

    const summary = await collection.collect(Channel.ASHBY);
    expect(summary).toMatchObject({
      segmentsFailed: 0,
      batches: 1,
      collected: 2,
      costUsd: 0.1,
    });
    expect(segments.collected).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('records a succeeded run with the segment, window, cost and truncation', async () => {
    const rows = builders(2);
    const { collection, segments } = setup(rows, async (s) =>
      resultFor(s, undefined, {
        costUsd: 0.123456,
        truncatedQueryIds: [rows[1].id],
        fetched: 5,
      }),
    );
    await collection.collect(Channel.ASHBY);
    expect(segments.collected).toHaveLength(1);
    expect(segments.collected[0]!.run).toMatchObject({
      channel: Channel.ASHBY,
      segmentKey: 'ASHBY|backend|remote|EMEA',
      queryIds: rows.map((r) => r.id),
      status: 'succeeded',
      fetched: 5,
      costMicroUsd: 123456,
      capped: false,
      truncatedQueryIds: [rows[1].id],
      error: null,
    });
    expect(segments.collected[0]!.run.segmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a failed segment and keeps going with the next one', async () => {
    const rows = [
      ...builders(1, { domain: SkillDomain.backend }),
      ...builders(1, { domain: SkillDomain.frontend }),
    ];
    let calls = 0;
    const { collection, segments, warn } = setup(rows, async (s) => {
      if (calls++ === 0) throw new Error('Apify run FAILED');
      return resultFor(s);
    });
    const summary = await collection.collect(Channel.ASHBY);
    expect(segments.runs.map((r) => r.status)).toEqual(['failed']);
    expect(segments.collected.map((c) => c.run.status)).toEqual(['succeeded']);
    expect(segments.runs[0].error).toContain('Apify run FAILED');
    expect(segments.cursors.size).toBe(1);
    expect(summary).toMatchObject({
      segments: 2,
      segmentsFailed: 1,
      batches: 1,
      collected: 2,
      costUsd: 0.1,
    });
    expect(warn).toHaveBeenCalled();
  });

  it.each(['storage', 'database'] as const)(
    'includes paid collection cost when %s fails, but counts only stored items',
    async (failure) => {
      const rows = builders(11);
      const { collection, storage, segments, ingestQueue } = setup(
        rows,
        async (search) => resultFor(search, undefined, { costUsd: 0.25 }),
      );
      if (failure === 'storage') storage.failNextPut = true;
      else
        vi.spyOn(segments, 'recordCollectedRun').mockRejectedValueOnce(
          new Error('db down'),
        );

      expect(await collection.collect(Channel.ASHBY)).toEqual({
        channel: Channel.ASHBY,
        builders: 11,
        segments: 2,
        segmentsFailed: 1,
        segmentsSkipped: 0,
        queriesSkipped: 0,
        batches: 1,
        collected: 2,
        costUsd: 0.5,
      });
      expect(segments.runs[0]).toMatchObject({
        status: 'failed',
        costMicroUsd: 250000,
      });
      expect(segments.collected).toHaveLength(1);
      expect(ingestQueue.enqueue).toHaveBeenCalledTimes(1);
    },
  );

  it('treats unreported cost as zero in totals while retaining null in the run', async () => {
    const { collection, segments } = setup(builders(1), async (search) =>
      resultFor(search, undefined, { costUsd: null }),
    );
    expect(await collection.collect(Channel.ASHBY)).toMatchObject({
      costUsd: 0,
      collected: 2,
      batches: 1,
      segmentsFailed: 0,
    });
    expect(segments.collected[0]?.run.costMicroUsd).toBeNull();
  });

  it('does not advance cursors of a run stopped by its charge cap', async () => {
    const { collection, segments } = setup(builders(2), async (s) =>
      resultFor(s, undefined, { capped: true }),
    );
    await collection.collect(Channel.ASHBY);
    expect(segments.collected[0]!.run).toMatchObject({
      capped: true,
      status: 'succeeded',
    });
    expect(segments.collected[0]!.advance).toEqual([]);
    expect(segments.cursors.size).toBe(0);
  });

  it('fails the job only when every segment failed', async () => {
    const { collection } = setup(builders(2), async () => {
      throw new Error('down');
    });
    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow(/ASHBY.*1/);
  });

  it('does nothing without active builders', async () => {
    const { collection, collector, segments } = setup([]);
    expect(await collection.collect(Channel.ASHBY)).toMatchObject({
      builders: 0,
      segments: 0,
    });
    expect(collector.collect).not.toHaveBeenCalled();
    expect(segments.runs).toEqual([]);
    expect(segments.collected).toEqual([]);
  });
});

const HOUR = 3_600_000;
const live = (runId = 'other') => ({
  runId,
  since: new Date(Date.now() - 24 * HOUR),
  until: new Date(Date.now() + HOUR),
  expiresAt: new Date(Date.now() + HOUR),
});

describe('CollectionService claims', () => {
  it('skips a query another run holds and searches the rest', async () => {
    const rows = builders(3);
    const { collection, collector, segments } = setup(rows);
    segments.claims.set(rows[0].id, live());

    const summary = await collection.collect(Channel.ASHBY);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    const [search] = collector.collect.mock.calls[0];
    const searched = rows.slice(1).map((row) => row.id);
    expect(search.queries.map((q) => q.id)).toEqual(searched);
    const { run } = segments.collected[0]!;
    expect(run.queryIds).toEqual(searched);
    expect(run.segmentHash).toBe(segmentHash(run.segmentKey, searched));
    expect(summary).toMatchObject({ queriesSkipped: 1, segmentsSkipped: 0 });
  });

  it('skips a segment whose queries are all held, without calling the collector or recording a run', async () => {
    const rows = builders(2);
    const { collection, collector, segments } = setup(rows);
    for (const row of rows) segments.claims.set(row.id, live());

    const summary = await collection.collect(Channel.ASHBY);

    expect(collector.collect).not.toHaveBeenCalled();
    expect(segments.runs).toEqual([]);
    expect(segments.collected).toEqual([]);
    expect(summary).toMatchObject({
      segments: 1,
      segmentsSkipped: 1,
      segmentsFailed: 0,
      queriesSkipped: 2,
    });
  });

  it('skips a query already covered up to until', async () => {
    const rows = builders(2);
    const { collection, collector, segments } = setup(rows);
    segments.cursors.set(rows[0].id, new Date(Date.now() + 60_000));

    const summary = await collection.collect(Channel.ASHBY);

    const [search] = collector.collect.mock.calls[0];
    expect(search.queries.map((q) => q.id)).toEqual([rows[1].id]);
    expect(summary).toMatchObject({ queriesSkipped: 1 });
  });

  it('recomputes the window from the cursor returned by the claim', async () => {
    const rows = builders(2, { channel: Channel.LINKEDIN_POSTS });
    const { collection, collector, segments } = setup(
      rows,
      undefined,
      Channel.LINKEDIN_POSTS,
    );
    const fresh = new Date(Date.now() - HOUR);
    for (const row of rows) segments.cursors.set(row.id, fresh);

    await collection.collect(Channel.LINKEDIN_POSTS);

    const [search] = collector.collect.mock.calls[0];
    expect(search.since.getTime()).toBe(fresh.getTime() - 15 * 60_000);
  });

  it('releases claims and moves cursors on success', async () => {
    const rows = builders(2);
    const { collection, segments } = setup(rows);

    await collection.collect(Channel.ASHBY);

    const { run } = segments.collected[0]!;
    expect(segments.claims.size).toBe(0);
    for (const row of rows)
      expect(segments.cursors.get(row.id)).toEqual(run.windowEnd);
  });

  it('releases claims without moving cursors on a capped run', async () => {
    const { collection, segments } = setup(builders(2), async (s) =>
      resultFor(s, undefined, { capped: true }),
    );

    await collection.collect(Channel.ASHBY);

    expect(segments.claims.size).toBe(0);
    expect(segments.cursors.size).toBe(0);
  });

  it('releases claims on a failed fetch', async () => {
    const { collection, segments } = setup(builders(2), async () => {
      throw new Error('down');
    });
    const claim = vi.spyOn(segments, 'claim');

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow();

    expect(segments.claims.size).toBe(0);
    expect(segments.runs[0]).toMatchObject({
      status: 'failed',
      id: claim.mock.calls[0][0],
    });
    expect(segments.cursors.size).toBe(0);
  });

  it('releases claims even when recording the failure throws', async () => {
    const { collection, segments } = setup(builders(2), async () => {
      throw new Error('down');
    });
    segments.failRecordRun = true;
    const claim = vi.spyOn(segments, 'claim');

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow(/ASHBY/);

    expect(segments.claims.size).toBe(0);
    expect(segments.released).toContain(claim.mock.calls[0][0]);
  });

  it('releases claims when narrowing the segment throws', async () => {
    const rows = builders(2);
    const { collection, collector, segments } = setup(rows);
    const claim = vi.spyOn(segments, 'claim').mockImplementation(
      async (runId, ids, window, leaseMs) => {
        await FakeSearchSegmentsRepository.prototype.claim.call(
          segments,
          runId,
          ids,
          window,
          leaseMs,
        );
        return {
          claimed: [{ id: 'not-a-member', coveredUntil: null }],
          skipped: [],
        };
      },
    );

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow();

    expect(collector.collect).not.toHaveBeenCalled();
    expect(segments.released).toContain(claim.mock.calls[0][0]);
    expect(segments.claims.size).toBe(0);
    expect(segments.runs[0]).toMatchObject({ status: 'failed' });
  });
});

describe('channelJobsConfig', () => {
  it('collects LinkedIn hourly over a day at most', () => {
    for (const channel of [
      Channel.LINKEDIN_JOB_BOARD,
      Channel.LINKEDIN_POSTS,
    ]) {
      expect(channelJobsConfig[channel]).toMatchObject({
        schedule: { pattern: '0 * * * *', timezone: 'UTC' },
        window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 },
      });
      expect(channelJobsConfig[channel].window).not.toHaveProperty(
        'minimumHours',
      );
    }
  });

  it('collects Google boards daily over at least three days', () => {
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY]) {
      expect(channelJobsConfig[channel]).toMatchObject({
        schedule: { pattern: '0 6 * * *', timezone: 'UTC' },
        window: {
          initialHours: 72,
          overlapMinutes: 0,
          maximumHours: 168,
          minimumHours: 72,
        },
      });
    }
  });
});
