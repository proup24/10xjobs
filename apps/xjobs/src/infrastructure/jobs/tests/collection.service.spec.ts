import { Logger } from '@nestjs/common';
import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  LinkedinJobBoardCollector,
  type RawCollectedItem,
  type SegmentResult,
  type SegmentSearch,
} from 'src/modules/collectors';
import {
  ApifyRunError,
  type ApifyActorProvider,
} from 'src/modules/collectors/providers/apify/apify.provider';
import {
  linkedinGeoId,
  mergedLinkedinKeyword,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { FakeActivityRepository } from 'src/modules/activity/testing/fakes';
import { ingestConfig, parseBatchFile } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { segmentHash, segmentKey } from 'src/modules/segments';
import {
  FakeLinkedinSearchSplitsRepository,
  FakeSearchSegmentsRepository,
} from 'src/modules/segments/testing/fakes';
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
  budgetUsd = 3,
) {
  const configGet = vi.fn((key: string) =>
    key === 'SEARCH_PAUSE_AFTER_HOURS' ? 24 : budgetUsd,
  );
  const activity = new FakeActivityRepository();
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
  const splits = new FakeLinkedinSearchSplitsRepository();
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
  const apify = { findRun: vi.fn(async (_runId: string) => null as unknown) };
  const ingestQueue = {
    enqueue: vi.fn(async (_batchId: string) => {
      order.push('enqueue');
    }),
  };
  const collection = new CollectionService(
    collectors[Channel.ASHBY] as never,
    collectors[Channel.GREEN_HOUSE] as never,
    collectors[Channel.LINKEDIN_JOB_BOARD] as never,
    collectors[Channel.LINKEDIN_JOB_BOARD_CHEAP] as never,
    collectors[Channel.LINKEDIN_JOB_BOARD_BEBITY] as never,
    collectors[Channel.LINKEDIN_POSTS] as never,
    queries as unknown as QuerySearchService,
    segments,
    splits,
    activity,
    storage,
    ingestQueue as unknown as IngestQueue,
    apify as unknown as ApifyActorProvider,
    { get: configGet } as never,
  );
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return {
    collection,
    collectors,
    configGet,
    queries,
    collector,
    segments,
    splits,
    activity,
    storage,
    ingestQueue,
    apify,
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
          // Each collector carries its own static config.
          expect(collectors[other].collect).toHaveBeenCalledWith(
            expect.objectContaining({ channel }),
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
    expect(collector.collect.mock.calls[0]).toHaveLength(1);
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
      segmentKey: 'ASHBY|backend|remote|emea',
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
        buildersPaused: 0,
        buildersWoken: 0,
        segments: 2,
        segmentsFailed: 1,
        segmentsSkipped: 0,
        segmentsDeferred: 0,
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

  it('fails only the LinkedIn search whose place has no geoId, naming it, and runs the rest', async () => {
    const linkedin = {
      channel: Channel.LINKEDIN_JOB_BOARD,
      type: Arrangement.onsite,
    };
    const good = builder({ ...linkedin, params: { location: 'emea' } });
    const bad = builder({ ...linkedin, params: { location: 'atlantis' } });
    // Like the real collector, resolve each query's geoId before any run.
    const { collection, segments, collector } = setup(
      [good, bad],
      async (s) => {
        for (const query of s.queries) linkedinGeoId(query.params);
        return resultFor(s);
      },
      Channel.LINKEDIN_JOB_BOARD,
    );
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(collector.collect).toHaveBeenCalledTimes(2);
    expect(segments.collected.map((c) => c.run.queryIds)).toEqual([[good.id]]);
    expect(segments.runs).toHaveLength(1);
    expect(segments.runs[0]).toMatchObject({
      status: 'failed',
      queryIds: [bad.id],
    });
    expect(segments.runs[0].error).toContain(
      'No LinkedIn geoId for location "atlantis"',
    );
    expect(summary).toMatchObject({
      segments: 2,
      segmentsFailed: 1,
      batches: 1,
    });
  });

  describe('LinkedIn job board tick length', () => {
    afterEach(() => vi.useRealTimers());

    const tick = async (minutes: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = new Date('2026-11-12T10:00:00Z');
      vi.setSystemTime(start);
      const { collection, warn } = setup(
        builders(1, {
          channel: Channel.LINKEDIN_JOB_BOARD,
          params: { location: 'emea' },
        }),
        async (s) => {
          vi.setSystemTime(start.getTime() + minutes * 60_000);
          return resultFor(s);
        },
        Channel.LINKEDIN_JOB_BOARD,
      );
      const log = vi.mocked(Logger.prototype.log);
      await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      return { warn, log };
    };

    it('logs the tick duration', async () => {
      const { log } = await tick(5);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(`durationMs=${5 * 60_000}`),
      );
    });

    it('warns when a tick runs longer than 60 minutes', async () => {
      const { warn } = await tick(61);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /took 61 minutes, over 60: jobs may be missed, because each search asks only for the last hour/,
        ),
      );
    });

    it('does not warn at 60 minutes', async () => {
      const { warn } = await tick(60);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('jobs may be missed'),
      );
    });
  });

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

describe('CollectionService LinkedIn search splits', () => {
  const ROWS = 1000;
  const linkedin = (count: number) =>
    builders(count, {
      channel: Channel.LINKEDIN_JOB_BOARD,
      type: Arrangement.remote,
      params: { location: 'emea' },
    });
  /** A full result: the row limit reached, every member truncated. */
  const full = (s: SegmentSearch) =>
    resultFor(s, () => [item(1)], {
      fetched: ROWS,
      truncatedQueryIds: s.queries.map((q) => q.id),
    });
  const small = (s: SegmentSearch) =>
    resultFor(s, () => [item(1)], { fetched: 3 });
  const ids = (s: SegmentSearch) => s.queries.map((q) => q.id);
  const run = (
    rows: QuerySearchBuilderRow[],
    collect: (s: SegmentSearch) => SegmentResult,
  ) => setup(rows, async (s) => collect(s), Channel.LINKEDIN_JOB_BOARD);
  const searches = (collector: ReturnType<typeof setup>['collector']) =>
    collector.collect.mock.calls.map(([s]) => s);

  it('uses one LinkedIn row limit of 1000 rows, with a $1.10 cap', () => {
    expect(channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run).toEqual({
      actor: 'harvestapi/linkedin-job-search',
      maxRowsPerSearch: ROWS,
      maxRunChargeUsd: 1.1,
    });
  });

  it('runs a full 2-member search again as two halves, and only the halves move cursors', async () => {
    const rows = linkedin(2);
    const [a, b] = rows.map((r) => r.id);
    const { collection, collector, segments } = run(rows, (s) =>
      s.queries.length > 1 ? full(s) : small(s),
    );
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(searches(collector).map(ids)).toEqual([[a, b], [a], [b]]);
    // Every run asks the collector's one row limit.
    for (const s of searches(collector))
      expect(s).not.toHaveProperty('maxItems');
    // Every run searches the same hour.
    const windows = new Set(
      searches(collector).map((s) => `${+s.since}-${+s.until}`),
    );
    expect(windows.size).toBe(1);
    expect(segments.collected.map((c) => c.advance)).toEqual([[], [a], [b]]);
    expect(segments.collected.map((c) => c.run.queryIds)).toEqual([
      [a, b],
      [a],
      [b],
    ]);
    expect(segments.collected[1]?.run.segmentHash).toBe(
      segmentHash(segmentKey(rows[0]), [a]),
    );
    expect(segments.cursors.get(a)).toEqual(
      segments.collected[1]?.run.windowEnd,
    );
    expect(segments.cursors.get(b)).toEqual(
      segments.collected[2]?.run.windowEnd,
    );
    expect(segments.claims.size).toBe(0);
    expect(summary).toMatchObject({
      segments: 2,
      batches: 3,
      segmentsFailed: 0,
    });
  });

  it('names the segment in each search, for the collector to log', async () => {
    const rows = linkedin(1);
    const { collection, collector } = run(rows, small);
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(searches(collector)[0]!.segmentKey).toBe(segmentKey(rows[0]!));
  });

  it('logs a group cut by keyword length once, and a lone over-long builder once', async () => {
    const worded = (spellings: string[]) =>
      builder({
        channel: Channel.LINKEDIN_JOB_BOARD,
        type: Arrangement.remote,
        params: { location: 'emea', roleWords: ['engineer'], spellings },
      });
    const rows = [
      ...Array.from({ length: 30 }, (_, i) =>
        worded([`technology-number-${i}`]),
      ),
      worded(Array.from({ length: 40 }, (_, i) => `technology-${i}`)),
    ];
    const { collection, warn } = run(rows, small);
    const logs = vi.mocked(Logger.prototype.log);
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    const key = segmentKey(rows[0]!);
    const cuts = logs.mock.calls.filter(([text]) =>
      String(text).includes('keyword length'),
    );
    expect(cuts).toEqual([
      [
        `${key} cut into ${summary.segments} searches for keyword length (31 members, 1 part)`,
      ],
    ]);
    const over = warn.mock.calls.filter(([text]) =>
      String(text).includes('over the LinkedIn keyword limit'),
    );
    expect(over).toHaveLength(1);
    const line = String(over[0]![0]);
    expect(line.startsWith(`Segment ${key} (`)).toBe(true);
    expect(line).toMatch(
      / keyword is over the LinkedIn keyword limit: \d+ characters, 41 terms; it is sent alone, and LinkedIn may degrade it$/,
    );
  });

  it('remembers the split with setParts 2 for the group', async () => {
    const rows = linkedin(2);
    const { collection, splits } = run(rows, (s) =>
      s.queries.length > 1 ? full(s) : small(s),
    );
    const setParts = vi.spyOn(splits, 'setParts');
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(setParts).toHaveBeenCalledTimes(1);
    expect(setParts).toHaveBeenCalledWith(
      segmentKey(rows[0]),
      2,
      expect.any(Date),
    );
    expect(splits.splits.get(segmentKey(rows[0]))?.parts).toBe(2);
  });

  it('halves a full half again until it fits', async () => {
    const rows = linkedin(4);
    const [a, b, c, d] = rows.map((r) => r.id);
    const { collection, collector, segments, splits } = run(rows, (s) =>
      s.queries.length > 1 && ids(s).includes(a) ? full(s) : small(s),
    );
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(searches(collector).map(ids)).toEqual([
      [a, b, c, d],
      [a, b],
      [a],
      [b],
      [c, d],
    ]);
    expect(segments.collected.map((x) => x.advance)).toEqual([
      [],
      [],
      [a],
      [b],
      [c, d],
    ]);
    expect(summary).toMatchObject({ segments: 3, batches: 5 });
    expect(splits.splits.get(segmentKey(rows[0]))?.parts).toBe(3);
  });

  it('moves the cursors of a full single member, runs nothing more, and says once that postings are lost', async () => {
    const rows = linkedin(1);
    const [a] = rows.map((r) => r.id);
    const { collection, collector, segments, splits, warn } = run(rows, full);
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(segments.collected.map((x) => x.advance)).toEqual([[a]]);
    expect(segments.cursors.get(a)).toEqual(
      segments.collected[0]?.run.windowEnd,
    );
    const lost = warn.mock.calls.filter(([text]) =>
      String(text).includes('older postings'),
    );
    expect(lost).toEqual([
      [
        `${segmentKey(rows[0])} is full at 1000 rows; older postings in this hour are lost`,
      ],
    ]);
    expect(summary).toMatchObject({ segments: 1, batches: 1 });
    // A full single member is not a split.
    expect(splits.splits.size).toBe(0);
  });

  it('does not say postings are lost when a full single member was capped, and keeps its cursors', async () => {
    const rows = linkedin(1);
    const { collection, segments, warn } = run(rows, (s) =>
      resultFor(s, () => [item(1)], {
        fetched: ROWS,
        truncatedQueryIds: s.queries.map((q) => q.id),
        capped: true,
      }),
    );
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(segments.collected.map((x) => x.advance)).toEqual([[]]);
    expect(
      warn.mock.calls.filter(([text]) =>
        String(text).includes('older postings'),
      ),
    ).toEqual([]);
  });

  it('treats a full run narrowed to one member by its claim as a single member', async () => {
    const rows = linkedin(2);
    const [a, b] = rows.map((r) => r.id);
    const { collection, collector, segments, warn } = run(rows, full);
    segments.claims.set(a, live());
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(searches(collector).map(ids)).toEqual([[b]]);
    expect(segments.collected.map((x) => x.advance)).toEqual([[b]]);
    expect(segments.cursors.get(b)).toEqual(
      segments.collected[0]?.run.windowEnd,
    );
    expect(segments.cursors.has(a)).toBe(false);
    expect(
      warn.mock.calls.filter(([text]) =>
        String(text).includes('full at 1000 rows'),
      ),
    ).toHaveLength(1);
    expect(summary).toMatchObject({
      segments: 1,
      batches: 1,
      queriesSkipped: 1,
    });
  });

  it('keeps cursors when a half fails, and moves the other half', async () => {
    const rows = linkedin(2);
    const [a, b] = rows.map((r) => r.id);
    const { collection, segments } = run(rows, (s) => {
      if (s.queries.length > 1) return full(s);
      if (ids(s)[0] === a) throw new Error('down');
      return small(s);
    });
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(segments.cursors.has(a)).toBe(false);
    expect(segments.cursors.has(b)).toBe(true);
    expect(segments.runs).toHaveLength(1);
    expect(summary).toMatchObject({
      segments: 2,
      segmentsFailed: 1,
      batches: 2,
    });
  });

  it('starts no half once stopping, and moves no cursor', async () => {
    const rows = linkedin(2);
    let stop = () => undefined as void;
    const { collection, collector, segments } = run(rows, (s) => {
      stop();
      return full(s);
    });
    stop = () => collection.stop();
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(segments.cursors.size).toBe(0);
    expect(segments.claims.size).toBe(0);
    expect(summary).toMatchObject({
      segments: 2,
      segmentsDeferred: 2,
      segmentsFailed: 0,
    });
  });

  it('cuts a group into the remembered parts', async () => {
    const rows = linkedin(4);
    const { collection, collector, splits } = run(rows, small);
    splits.splits.set(segmentKey(rows[0]), {
      parts: 2,
      splitAt: new Date(Date.now() - 10 * 60_000),
    });
    const setParts = vi.spyOn(splits, 'setParts');
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(searches(collector).map(ids)).toEqual([
      rows.slice(0, 2).map((r) => r.id),
      rows.slice(2).map((r) => r.id),
    ]);
    // Split under an hour ago: kept.
    expect(setParts).not.toHaveBeenCalled();
  });

  it('halves a remembered split over 90 minutes old once its searches return under 250 rows', async () => {
    const rows = linkedin(4);
    const { collection, splits } = run(rows, (s) =>
      resultFor(s, () => [item(1)], { fetched: 200 }),
    );
    const key = segmentKey(rows[0]);
    splits.splits.set(key, {
      parts: 2,
      splitAt: new Date(Date.now() - 2 * HOUR),
    });
    const setParts = vi.spyOn(splits, 'setParts');
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(setParts).toHaveBeenCalledWith(key, 1, expect.any(Date));
  });

  it('halves a remembered split over an hour old once its searches run small', async () => {
    const rows = linkedin(4);
    const { collection, splits } = run(rows, small);
    const key = segmentKey(rows[0]);
    splits.splits.set(key, {
      parts: 2,
      splitAt: new Date(Date.now() - 2 * HOUR),
    });
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(splits.splits.has(key)).toBe(false);
  });

  describe('stale remembered splits', () => {
    const recent = () => ({
      parts: 2,
      splitAt: new Date(Date.now() - 10 * 60_000),
    });
    const STALE = 'LINKEDIN_JOB_BOARD|remote|group:{"place":{"geoId":"gone"}}';

    it('forgets a split whose group was not built, once the tick reached every group', async () => {
      const rows = linkedin(4);
      const { collection, splits } = run(rows, small);
      const key = segmentKey(rows[0]);
      splits.splits.set(key, recent());
      splits.splits.set(STALE, recent());
      await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      expect([...splits.splits.keys()]).toEqual([key]);
    });

    it('keeps it when the daily budget stopped the tick', async () => {
      const rows = [...linkedin(1), ...linkedin(1)];
      const { collection, splits } = setup(
        rows,
        async (s) => ({ ...small(s), costUsd: 1 }),
        Channel.LINKEDIN_JOB_BOARD,
        1,
      );
      splits.splits.set(segmentKey(rows[0]), recent());
      splits.splits.set(STALE, recent());
      const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      expect(summary.segmentsDeferred).toBe(1);
      expect(splits.splits.has(STALE)).toBe(true);
    });

    it('keeps it when shutdown deferred a segment', async () => {
      const rows = [...linkedin(1), ...linkedin(1)];
      let stop = () => undefined as void;
      const { collection, splits } = run(rows, (s) => {
        stop();
        return small(s);
      });
      stop = () => collection.stop();
      splits.splits.set(segmentKey(rows[0]), recent());
      splits.splits.set(STALE, recent());
      const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      expect(summary.segmentsDeferred).toBe(1);
      expect(splits.splits.has(STALE)).toBe(true);
    });

    it('keeps the tick going when pruning fails', async () => {
      const rows = linkedin(1);
      const { collection, splits, warn } = run(rows, small);
      vi.spyOn(splits, 'prune').mockRejectedValue(new Error('db down'));
      const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      expect(summary.batches).toBe(1);
      expect(
        warn.mock.calls.some(([text]) =>
          String(text).includes('could not be pruned'),
        ),
      ).toBe(true);
    });
  });

  it('does not undo a split when a search failed, since its size is unknown', async () => {
    const rows = linkedin(4);
    const { collection, splits } = run(rows, (s) => {
      if (ids(s).includes(rows[0].id)) throw new Error('down');
      return small(s);
    });
    const key = segmentKey(rows[0]);
    splits.splits.set(key, {
      parts: 2,
      splitAt: new Date(Date.now() - 2 * HOUR),
    });
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(splits.splits.get(key)?.parts).toBe(2);
  });

  it('collects without remembered splits when they cannot be read', async () => {
    const rows = linkedin(2);
    const { collection, collector, splits } = run(rows, small);
    vi.spyOn(splits, 'parts').mockRejectedValue(new Error('db down'));
    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ batches: 1, segmentsFailed: 0 });
  });

  it('never splits or reads splits for other channels', async () => {
    const rows = builders(2);
    const { collection, collector, segments, splits } = setup(rows, async (s) =>
      resultFor(s, undefined, {
        truncatedQueryIds: s.queries.map((q) => q.id),
      }),
    );
    const parts = vi.spyOn(splits, 'parts');
    const setParts = vi.spyOn(splits, 'setParts');
    await collection.collect(Channel.ASHBY);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(segments.collected[0]!.advance).toEqual(rows.map((r) => r.id));
    expect(parts).not.toHaveBeenCalled();
    expect(setParts).not.toHaveBeenCalled();
  });
});

describe('CollectionService daily budget', () => {
  const linkedin = (count: number, location = 'emea') =>
    builders(count, {
      channel: Channel.LINKEDIN_JOB_BOARD,
      type: Arrangement.remote,
      params: { location },
    });
  const full = (s: SegmentSearch, costUsd: number | null = 0.15) =>
    resultFor(s, () => [item(1)], {
      fetched: 1000,
      truncatedQueryIds: s.queries.map((q) => q.id),
      costUsd,
    });
  const small = (s: SegmentSearch, costUsd: number | null = 0.15) =>
    resultFor(s, () => [item(1)], { fetched: 3, costUsd });
  const run = (
    rows: QuerySearchBuilderRow[],
    collect: (s: SegmentSearch) => SegmentResult,
    budgetUsd: number,
  ) =>
    setup(rows, async (s) => collect(s), Channel.LINKEDIN_JOB_BOARD, budgetUsd);
  const spend = (
    segments: ReturnType<typeof setup>['segments'],
    costMicroUsd: number | null,
    channel = Channel.LINKEDIN_JOB_BOARD,
  ) =>
    segments.runs.push({
      id: `spent-${segments.runs.length}`,
      channel,
      segmentKey: 'k',
      segmentHash: 'h',
      queryIds: [],
      windowStart: new Date(),
      windowEnd: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      searchTotals: null,
      error: null,
      apifyRunId: null,
      costFinalAt: null,
    });

  it('starts no run once the day has reached the cap, and says so once', async () => {
    const rows = [...linkedin(1), ...linkedin(1, 'europe')];
    const { collection, collector, segments, warn } = run(rows, small, 1);
    spend(segments, 1_000_000);

    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ batches: 0, segmentsFailed: 0 });
    expect(summary.segmentsDeferred).toBe(summary.segments);
    expect(segments.cursors.size).toBe(0);
    const budgetWarnings = warn.mock.calls.filter(([text]) =>
      String(text).includes('daily budget'),
    );
    expect(budgetWarnings).toHaveLength(1);
    expect(budgetWarnings[0]![0]).toMatch(
      /^LINKEDIN_JOB_BOARD daily budget \$1 reached \(\$1 since \d{4}-\d\d-\d\dT[\d:.]+Z\); collection resumes tomorrow$/,
    );
  });

  it('runs while the day is under the cap', async () => {
    const { collection, collector, segments } = run(linkedin(1), small, 1);
    spend(segments, 400_000);

    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ batches: 1, segmentsDeferred: 0 });
  });

  it('counts a run with no reported cost at the $1.10 cap', async () => {
    const rows = [...linkedin(1), ...linkedin(1, 'europe')];
    const { collection, collector, segments } = run(
      rows,
      (s) => small(s, null),
      1.1,
    );

    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.segmentsDeferred).toBe(1);
    expect(segments.collected).toHaveLength(1);
  });

  it('counts earlier runs with no recorded cost at the $1.10 cap', async () => {
    const { collection, collector, segments } = run(linkedin(1), small, 2.2);
    spend(segments, null);
    spend(segments, null);

    await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    expect(collector.collect).not.toHaveBeenCalled();
  });

  it('stops a split half once the cap is reached, and moves no cursor for it', async () => {
    const rows = linkedin(2);
    const { collection, collector, segments, splits } = run(
      rows,
      (s) => (s.queries.length === 2 ? full(s) : small(s)),
      0.25,
    );

    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    // The full search (0.15) and the first half (0.30 in all); the second half never starts.
    expect(collector.collect).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ segmentsFailed: 0, segmentsDeferred: 1 });
    expect(segments.collected).toHaveLength(2);
    expect(segments.collected[0]!.advance).toEqual([]);
    expect(segments.collected[1]!.advance).toHaveLength(1);
    expect(segments.cursors.size).toBe(1);
    // The skipped half says nothing of the group's size: its split is kept.
    expect(splits.splits.get(segmentKey(rows[0]!))?.parts).toBe(2);
  });

  it('does not throw when a segment fails and a full one succeeds but its halves are skipped', async () => {
    // Groups run in key order: the failing one first.
    const failing = linkedin(1, 'europe');
    const splitting = linkedin(2);
    const failingId = failing[0]!.id;
    const { collection, collector } = run(
      [...failing, ...splitting],
      (s) => {
        if (s.queries.some((q) => q.id === failingId))
          throw new Error('apify down');
        return full(s, 0.3);
      },
      1.3,
    );

    const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);

    // The failed run counts at its charge cap (1.10), the full search (0.30) reaches the cap; both halves are skipped.
    expect(collector.collect).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      segmentsFailed: 1,
      batches: 1,
      segmentsDeferred: 2,
    });
  });

  it('never charges a place with no geoId: the other search keeps running across ticks, and spend grows by its cost alone', async () => {
    const words = { roleWords: ['engineer'], spellings: ['go'] };
    const good = builder({
      channel: Channel.LINKEDIN_JOB_BOARD,
      params: { location: 'europe', workType: '2', ...words },
    });
    const unresolved = builder({
      channel: Channel.LINKEDIN_JOB_BOARD,
      params: { location: 'asia pacific', workType: '2', ...words },
    });
    // The real collector over a fake actor: it fails the APAC place before any Apify call.
    const actorRun = vi.fn(async () => ({
      items: [{ id: 'j1', _meta: { pagination: { totalElements: 1 } } }],
      costUsd: 0.1,
      runId: 'apify-1',
    }));
    const real = new LinkedinJobBoardCollector({
      run: actorRun,
    } as unknown as ApifyActorProvider);
    const { collection, segments, warn } = run(
      [good, unresolved],
      () => {
        throw new Error('unused');
      },
      0.5,
    );
    const linkedinCollector = (
      collection as unknown as {
        linkedinJobs: { collect: (s: SegmentSearch) => unknown };
      }
    ).linkedinJobs;
    vi.mocked(linkedinCollector.collect).mockImplementation((s) =>
      real.collect(s),
    );

    for (let tick = 1; tick <= 4; tick++) {
      // Each tick searches a new hour.
      segments.cursors.clear();
      const summary = await collection.collect(Channel.LINKEDIN_JOB_BOARD);
      expect(summary).toMatchObject({
        batches: 1,
        segmentsFailed: 1,
        segmentsDeferred: 0,
      });
    }

    expect(actorRun).toHaveBeenCalledTimes(4);
    const spent = await segments.spentMicroUsd(
      Channel.LINKEDIN_JOB_BOARD,
      new Date(0),
      1_100_000,
    );
    expect(spent).toBe(400_000);
    const failed = segments.runs.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(4);
    for (const r of failed) {
      expect(r.costMicroUsd).toBe(0);
      expect(r.queryIds).toEqual([unresolved.id]);
      expect(r.segmentKey).toContain('|unresolved:');
      expect(r.error).toContain('asia pacific');
    }
    expect(
      warn.mock.calls.filter(([text]) =>
        /unresolved:.*failed: .*asia pacific/.test(String(text)),
      ),
    ).toHaveLength(4);
    expect(
      warn.mock.calls.some(([text]) => String(text).includes('daily budget')),
    ).toBe(false);
  });

  it('still counts a failed Apify call with no reported cost at its charge cap', async () => {
    const { collection, segments } = run(
      linkedin(1),
      () => {
        throw new Error('apify down');
      },
      3,
    );
    await collection.collect(Channel.LINKEDIN_JOB_BOARD).catch(() => undefined);
    expect(segments.runs).toHaveLength(1);
    expect(segments.runs[0]!.costMicroUsd).toBeNull();
    expect(
      await segments.spentMicroUsd(
        Channel.LINKEDIN_JOB_BOARD,
        new Date(0),
        1_100_000,
      ),
    ).toBe(1_100_000);
  });

  it('does not cap or read the spend of other channels', async () => {
    const { collection, collector, segments } = setup(
      builders(2, { channel: Channel.ASHBY }),
      undefined,
      Channel.ASHBY,
      0.01,
    );
    spend(segments, 5_000_000, Channel.ASHBY);
    const spent = vi.spyOn(segments, 'spentMicroUsd');

    const summary = await collection.collect(Channel.ASHBY);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.segmentsDeferred).toBe(0);
    expect(spent).not.toHaveBeenCalled();
  });
});

describe('CollectionService posts budget and incomplete runs', () => {
  const POSTS = Channel.LINKEDIN_POSTS;
  const posts = (count: number, position = 'fullstack') =>
    builders(count, {
      channel: POSTS,
      params: {
        language: 'en',
        position,
        hiringWord: 'hiring',
        positionWords: [position],
        spellings: ['react'],
        remote: true,
      },
    });
  const spend = (
    segments: ReturnType<typeof setup>['segments'],
    costMicroUsd: number | null,
  ) =>
    segments.runs.push({
      id: `spent-${segments.runs.length}`,
      channel: POSTS,
      segmentKey: 'k',
      segmentHash: 'h',
      queryIds: [],
      windowStart: new Date(),
      windowEnd: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      searchTotals: null,
      error: null,
      apifyRunId: null,
      costFinalAt: null,
    });

  it('reads its own budget setting', async () => {
    const { collection, configGet } = setup(posts(1), undefined, POSTS, 1.5);
    await collection.collect(POSTS);
    expect(configGet).toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS',
      expect.anything(),
    );
  });

  it('caps each posts run at the budget left', async () => {
    const { collection, collector, segments } = setup(
      posts(1),
      undefined,
      POSTS,
      1.5,
    );
    spend(segments, 1_200_000);

    await collection.collect(POSTS);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    const [search] = collector.collect.mock.calls[0];
    expect(Math.abs(search.maxChargeUsd! - 0.3)).toBeLessThan(1e-9);
  });

  it('lowers the next run of the tick by what the last one cost', async () => {
    const { collection, collector } = setup(
      [...posts(1), ...posts(1, 'backend')],
      async (s) => resultFor(s, undefined, { costUsd: 1 }),
      POSTS,
      1.5,
    );

    await collection.collect(POSTS);

    expect(collector.collect).toHaveBeenCalledTimes(2);
    const limits = collector.collect.mock.calls.map(([s]) => s.maxChargeUsd!);
    expect(limits[0]).toBeCloseTo(1.5, 9);
    expect(limits[1]).toBeCloseTo(0.5, 9);
  });

  it('skips posts segments once less than a cent is left', async () => {
    const { collection, collector, segments } = setup(
      posts(1),
      undefined,
      POSTS,
      1.5,
    );
    spend(segments, 1_495_000);

    const summary = await collection.collect(POSTS);

    expect(collector.collect).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      segmentsDeferred: 1,
      batches: 0,
      segmentsFailed: 0,
    });
    expect(segments.cursors.size).toBe(0);
  });

  it('starts no further run once a run left less than a cent', async () => {
    const { collection, collector } = setup(
      [...posts(1), ...posts(1, 'backend')],
      async (s) => resultFor(s, undefined, { costUsd: 1.495 }),
      POSTS,
      1.5,
    );

    const summary = await collection.collect(POSTS);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.segmentsDeferred).toBe(1);
  });

  it('stores an incomplete run without moving cursors', async () => {
    const rows = posts(1);
    const covered = new Date(Date.now() - 2 * 3_600_000);
    rows[0]!.coveredUntil = covered;
    const { collection, segments, ingestQueue, storage } = setup(
      rows,
      async (s) =>
        resultFor(s, () => [item(1), item(2), item(3)], {
          unattributed: [],
          fetched: 3,
          incomplete: 'no available resource',
        }),
      POSTS,
      1.5,
    );

    const summary = await collection.collect(POSTS);

    expect(summary).toMatchObject({ batches: 1, segmentsFailed: 0 });
    expect(segments.collected).toHaveLength(1);
    const { run, batch } = segments.collected[0]!;
    expect(batch.itemCount).toBe(3);
    expect(run).toMatchObject({
      status: 'partial',
      error: 'no available resource',
    });
    expect(ingestQueue.enqueue).toHaveBeenCalledWith(batch.id);
    const file = parseBatchFile(
      await storage.get(ingestConfig.bucket, batch.storageKey),
    );
    expect(file.itemsByQuery[rows[0]!.id]).toHaveLength(3);
    expect(segments.cursors.get(rows[0]!.id)).toEqual(covered);
    expect(segments.claims.size).toBe(0);
  });

  it('counts a posts run with no cost at 25 cents', async () => {
    const { collection, segments } = setup(posts(1), undefined, POSTS, 1.5);
    const spent = vi.spyOn(segments, 'spentMicroUsd');

    await collection.collect(POSTS);

    expect(spent).toHaveBeenCalledWith(POSTS, expect.any(Date), 250_000);
  });

  it('counts a posts fetch that throws at its full charge limit for the rest of the tick', async () => {
    let calls = 0;
    const { collection, collector, segments } = setup(
      [...posts(1), ...posts(1, 'backend')],
      async (s) => {
        calls += 1;
        if (calls === 1) throw new Error('apify down');
        return resultFor(s);
      },
      POSTS,
      1.5,
    );
    spend(segments, 1_000_000);

    // Every run that happened failed, so the job fails too.
    await expect(collection.collect(POSTS)).rejects.toThrow(
      'LINKEDIN_POSTS collection failed for all 1 segments',
    );

    // The first run could have charged all $0.50 left: the second never starts.
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(segments.runs).toHaveLength(2);
    const failed = segments.runs.find((r) => r.status === 'failed')!;
    expect(failed.costMicroUsd).toBeNull();
  });

  it('never splits or reruns a full posts run', async () => {
    const rows = posts(2);
    const { collection, collector, segments } = setup(
      rows,
      async (s) =>
        resultFor(s, undefined, {
          truncatedQueryIds: s.queries.map((q) => q.id),
        }),
      POSTS,
      1.5,
    );

    const summary = await collection.collect(POSTS);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.segments).toBe(1);
    const { run } = segments.collected[0]!;
    for (const row of rows)
      expect(segments.cursors.get(row.id)).toEqual(run.windowEnd);
  });
});

describe('CollectionService.stop', () => {
  it('finishes the segment in flight and leaves the rest unclaimed for the next run', async () => {
    const rows = builders(25);
    let stop = () => undefined as void;
    const { collection, collector, segments, ingestQueue } = setup(
      rows,
      async (s) => {
        stop();
        return resultFor(s);
      },
    );
    stop = () => collection.stop();
    const summary = await collection.collect(Channel.ASHBY);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(segments.collected).toHaveLength(1);
    expect(ingestQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(segments.runs).toEqual([]);
    // Only the first segment's members were claimed and moved.
    const first = rows.slice(0, 10).map((r) => r.id);
    expect([...segments.cursors.keys()].sort()).toEqual(first.sort());
    expect(segments.claims.size).toBe(0);
    expect(summary).toMatchObject({
      segments: 3,
      batches: 1,
      segmentsFailed: 0,
      segmentsDeferred: 2,
    });
  });

  it('does not fail the job when it stops before any segment', async () => {
    const { collection, collector } = setup(builders(2));
    collection.stop();
    expect(await collection.collect(Channel.ASHBY)).toMatchObject({
      segments: 1,
      segmentsDeferred: 1,
      segmentsFailed: 0,
    });
    expect(collector.collect).not.toHaveBeenCalled();
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
    const { overlapMinutes } = channelJobsConfig[Channel.LINKEDIN_POSTS].window;
    expect(overlapMinutes).toBeGreaterThan(0);
    expect(search.since.getTime()).toBe(
      fresh.getTime() - overlapMinutes * 60_000,
    );
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

  it('counts a segment whose claim fails as failed, releases it, and keeps going', async () => {
    const rows = [
      ...builders(1, { domain: SkillDomain.backend }),
      ...builders(1, { domain: SkillDomain.frontend }),
    ];
    const { collection, collector, segments } = setup(rows);
    const claim = segments.claim.bind(segments);
    const spy = vi
      .spyOn(segments, 'claim')
      .mockRejectedValueOnce(new Error('db down'))
      .mockImplementation(claim);
    const release = vi.spyOn(segments, 'releaseClaims');

    const summary = await collection.collect(Channel.ASHBY);

    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(spy.mock.calls[0][0]);
    expect(summary).toMatchObject({
      segments: 2,
      segmentsFailed: 1,
      segmentsSkipped: 0,
      batches: 1,
    });
  });

  it('releases claims when narrowing the segment throws', async () => {
    const rows = builders(2);
    const { collection, collector, segments } = setup(rows);
    const claim = vi
      .spyOn(segments, 'claim')
      .mockImplementation(async (runId, ids, window, leaseMs) => {
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
      });

    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow();

    expect(collector.collect).not.toHaveBeenCalled();
    expect(segments.released).toContain(claim.mock.calls[0][0]);
    expect(segments.claims.size).toBe(0);
    expect(segments.runs[0]).toMatchObject({ status: 'failed' });
  });
});

describe('channelJobsConfig', () => {
  it('collects LinkedIn jobs hourly 09-21 Morocco time over the last hour', () => {
    expect(channelJobsConfig[Channel.LINKEDIN_JOB_BOARD]).toMatchObject({
      schedule: { pattern: '0 9-21 * * 1-5', timezone: 'Africa/Casablanca' },
      window: { initialHours: 1, overlapMinutes: 0, maximumHours: 1 },
    });
  });

  it('collects posts hourly every day', () => {
    expect(channelJobsConfig[Channel.LINKEDIN_POSTS]).toMatchObject({
      queueName: 'collect-linkedin-posts',
      enabled: true,
      schedule: { pattern: '0 * * * *', timezone: 'Africa/Casablanca' },
      concurrency: 1,
      attempts: 1,
      claimLeaseMinutes: 30,
      run: { actor: 'harvestapi/linkedin-post-search', waitSecs: 900 },
    });
    expect(channelJobsConfig[Channel.LINKEDIN_POSTS].window).toEqual({
      initialHours: 24,
      overlapMinutes: 5,
      maximumHours: 24,
    });
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

describe('CollectionService trial channel (bebity)', () => {
  it('reads its own budget setting', async () => {
    const BEBITY = Channel.LINKEDIN_JOB_BOARD_BEBITY;
    const { collection, collector, configGet } = setup(
      builders(1, {
        channel: BEBITY,
        type: Arrangement.remote,
        params: { location: 'emea' },
      }),
      async (s) => resultFor(s, () => [item(1)], { fetched: 3 }),
      BEBITY,
    );
    await collection.collect(BEBITY);
    expect(configGet).toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY',
      expect.anything(),
    );
    expect(configGet).not.toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD',
      expect.anything(),
    );
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionService trial channel (cheap_scraper)', () => {
  const CHEAP = Channel.LINKEDIN_JOB_BOARD_CHEAP;
  const cheapRows = (count: number) =>
    builders(count, {
      channel: CHEAP,
      type: Arrangement.remote,
      params: { location: 'emea' },
    });
  const full = (s: SegmentSearch, costUsd: number | null = 0.15) =>
    resultFor(s, () => [item(1)], {
      fetched: 1000,
      truncatedQueryIds: s.queries.map((q) => q.id),
      costUsd,
    });
  const small = (s: SegmentSearch, costUsd: number | null = 0.15) =>
    resultFor(s, () => [item(1)], { fetched: 3, costUsd });

  it("runs the cheap collector, never harvestapi's", async () => {
    const { collection, collectors } = setup(
      cheapRows(1),
      async (s) => small(s),
      CHEAP,
    );
    await collection.collect(CHEAP);
    expect(collectors[CHEAP]!.collect).toHaveBeenCalledTimes(1);
    expect(
      collectors[Channel.LINKEDIN_JOB_BOARD]!.collect,
    ).not.toHaveBeenCalled();
  });

  it('reads its own budget setting and counts a null cost at $1.50', async () => {
    const rows = [
      ...cheapRows(1),
      ...builders(1, {
        channel: CHEAP,
        type: Arrangement.remote,
        params: { location: 'europe' },
      }),
    ];
    // Between harvestapi's cap ($1.10) and the trial's ($1.50): the second
    // segment is deferred only if the null-cost first run counted at $1.50.
    const { collection, collector, configGet, segments } = setup(
      rows,
      async (s) => small(s, null),
      CHEAP,
      1.3,
    );
    const spent = vi.spyOn(segments, 'spentMicroUsd');
    const summary = await collection.collect(CHEAP);
    expect(configGet).toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP',
      expect.anything(),
    );
    expect(configGet).not.toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD',
      expect.anything(),
    );
    expect(spent).toHaveBeenCalledWith(CHEAP, expect.any(Date), 1_500_000);
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.segmentsDeferred).toBe(1);
  });

  it('counts a null cost at harvestapi cap of $1.10 on its own channel', async () => {
    const { collection, segments } = setup(
      builders(1, {
        channel: Channel.LINKEDIN_JOB_BOARD,
        type: Arrangement.remote,
        params: { location: 'emea' },
      }),
      async (s) => small(s),
      Channel.LINKEDIN_JOB_BOARD,
    );
    const spent = vi.spyOn(segments, 'spentMicroUsd');
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(spent).toHaveBeenCalledWith(
      Channel.LINKEDIN_JOB_BOARD,
      expect.any(Date),
      1_100_000,
    );
  });

  it("counts only the trial channel's own spend", async () => {
    const { collection, collector, segments } = setup(
      cheapRows(1),
      async (s) => small(s),
      CHEAP,
      0.15,
    );
    segments.runs.push({
      id: 'other',
      channel: Channel.LINKEDIN_JOB_BOARD,
      segmentKey: 'k',
      segmentHash: 'h',
      queryIds: [],
      windowStart: new Date(),
      windowEnd: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd: 5_000_000,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      searchTotals: null,
      error: null,
      apifyRunId: null,
      costFinalAt: null,
    });
    await collection.collect(CHEAP);
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });

  it('the harvestapi tick still reads COLLECTION_DAILY_BUDGET_USD', async () => {
    const { collection, configGet } = setup(
      builders(1, {
        channel: Channel.LINKEDIN_JOB_BOARD,
        type: Arrangement.remote,
        params: { location: 'emea' },
      }),
      async (s) => small(s),
      Channel.LINKEDIN_JOB_BOARD,
    );
    await collection.collect(Channel.LINKEDIN_JOB_BOARD);
    expect(configGet).toHaveBeenCalledWith(
      'COLLECTION_DAILY_BUDGET_USD',
      expect.anything(),
    );
  });

  it('splits a full result into halves of 1000 rows each', async () => {
    const rows = cheapRows(2);
    const { collection, collector } = setup(
      rows,
      async (s) => (s.queries.length > 1 ? full(s) : small(s)),
      CHEAP,
    );
    await collection.collect(CHEAP);
    const searched = collector.collect.mock.calls.map(([s]) => s);
    expect(searched.map((s) => s.queries.length)).toEqual([2, 1, 1]);
    // No search overrides the collector's one row limit of 1000.
    for (const s of searched) expect(s).not.toHaveProperty('maxItems');
    expect(channelJobsConfig[CHEAP].run.maxRowsPerSearch).toBe(1000);
  });

  it('remembers splits with the channel row limit and prunes its own channel', async () => {
    const rows = cheapRows(2);
    const { collection, splits } = setup(
      rows,
      async (s) => (s.queries.length > 1 ? full(s) : small(s)),
      CHEAP,
    );
    const setParts = vi.spyOn(splits, 'setParts');
    const prune = vi.spyOn(splits, 'prune');
    await collection.collect(CHEAP);
    expect(prune).toHaveBeenCalledWith(CHEAP, [segmentKey(rows[0]!)]);
    expect(setParts).toHaveBeenCalledWith(
      segmentKey(rows[0]!),
      expect.any(Number),
      expect.any(Date),
    );
    expect(segmentKey(rows[0]!).startsWith('LINKEDIN_JOB_BOARD_CHEAP|')).toBe(
      true,
    );
  });
});

describe('CollectionService run ids and final costs', () => {
  const BOARD = Channel.LINKEDIN_JOB_BOARD;
  const rows = (channel: Channel = BOARD) =>
    builders(1, {
      channel,
      type: Arrangement.remote,
      params: { location: 'emea' },
    });
  const small = async (s: SegmentSearch) =>
    resultFor(s, () => [item(1)], { fetched: 3 });
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000);
  const recorded = (
    segments: FakeSearchSegmentsRepository,
    over: Partial<(typeof segments.runs)[number]> = {},
  ) =>
    segments.runs.push({
      id: 'earlier',
      channel: BOARD,
      segmentKey: 'k',
      segmentHash: 'h',
      queryIds: [],
      windowStart: minutesAgo(70),
      windowEnd: minutesAgo(10),
      startedAt: minutesAgo(11),
      finishedAt: minutesAgo(10),
      status: 'succeeded',
      fetched: 0,
      costMicroUsd: 147_200,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
      searchTotals: null,
      error: null,
      apifyRunId: 'run-earlier',
      costFinalAt: null,
      ...over,
    });

  it('stores the Apify run id of a succeeded run', async () => {
    const { collection, segments } = setup(rows(), small, BOARD);
    await collection.collect(BOARD);
    expect(segments.collected[0]!.run).toMatchObject({
      apifyRunId: 'run-1',
      costFinalAt: null,
    });
  });

  it('stores the run id of a run that failed after starting', async () => {
    const { collection, segments } = setup(
      rows(),
      async () => {
        throw new ApifyRunError('ended FAILED', 'run-9');
      },
      BOARD,
    );
    await expect(collection.collect(BOARD)).rejects.toThrow();
    expect(segments.runs[0]).toMatchObject({
      status: 'failed',
      apifyRunId: 'run-9',
      costMicroUsd: null,
    });
  });

  it('re-reads unsettled costs before reading the daily budget', async () => {
    const { collection, segments, apify } = setup(rows(), small, BOARD);
    recorded(segments);
    apify.findRun.mockResolvedValue({ usageTotalUsd: 0.1514 });
    const order: string[] = [];
    vi.spyOn(segments, 'settleCost').mockImplementation(async (...args) => {
      order.push('settle');
      return FakeSearchSegmentsRepository.prototype.settleCost.apply(
        segments,
        args,
      );
    });
    vi.spyOn(segments, 'spentMicroUsd').mockImplementation(async () => {
      order.push('spent');
      return 0;
    });

    await collection.collect(BOARD);

    expect(apify.findRun).toHaveBeenCalledWith('run-earlier');
    expect(segments.settleCost).toHaveBeenCalledWith(
      'earlier',
      151_400,
      expect.any(Date),
    );
    expect(order.slice(0, 2)).toEqual(['settle', 'spent']);
    expect(segments.runs[0]).toMatchObject({ costMicroUsd: 151_400 });
    expect(segments.runs[0]!.costFinalAt).toBeInstanceOf(Date);
  });

  it('does not mark a cost final within 5 minutes of the run finishing', async () => {
    const { collection, segments, apify } = setup(rows(), small, BOARD);
    recorded(segments, { finishedAt: minutesAgo(4) });
    apify.findRun.mockResolvedValue({ usageTotalUsd: 0.1514 });
    vi.spyOn(segments, 'settleCost');

    await collection.collect(BOARD);

    expect(segments.settleCost).toHaveBeenCalledWith('earlier', 151_400, null);
  });

  it('keeps the stored cost when the re-read fails', async () => {
    const { collection, segments, apify, collector, warn } = setup(
      rows(),
      small,
      BOARD,
    );
    recorded(segments);
    apify.findRun.mockRejectedValue(new Error('apify down'));
    vi.spyOn(segments, 'settleCost');

    const summary = await collection.collect(BOARD);

    expect(segments.settleCost).not.toHaveBeenCalled();
    expect(segments.runs[0]).toMatchObject({ costMicroUsd: 147_200 });
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(summary.batches).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apify down'));
  });

  it('re-reads runs finished in the last 24 hours', async () => {
    const { collection, segments } = setup(rows(), small, BOARD);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = new Date('2026-11-18T12:00:00Z');
      vi.setSystemTime(now);
      vi.spyOn(segments, 'unsettledCosts');
      await collection.collect(BOARD);
      expect(segments.unsettledCosts).toHaveBeenCalledWith(
        BOARD,
        new Date(now.getTime() - 24 * 3_600_000),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-read costs of other channels', async () => {
    const { collection, segments, apify } = setup(
      builders(1),
      undefined,
      Channel.ASHBY,
    );
    recorded(segments, { channel: Channel.ASHBY });
    vi.spyOn(segments, 'unsettledCosts');

    await collection.collect(Channel.ASHBY);

    expect(segments.unsettledCosts).not.toHaveBeenCalled();
    expect(apify.findRun).not.toHaveBeenCalled();
  });

  it("re-reads only the tick's own channel", async () => {
    const { collection, segments, apify } = setup(rows(), small, BOARD);
    recorded(segments, {
      id: 'other',
      channel: Channel.LINKEDIN_JOB_BOARD_BEBITY,
      apifyRunId: 'run-other',
    });

    await collection.collect(BOARD);

    expect(apify.findRun).not.toHaveBeenCalled();
  });
});

describe('CollectionService paused builders', () => {
  afterEach(() => vi.useRealTimers());

  const BOARD = Channel.LINKEDIN_JOB_BOARD;
  const POSTS = Channel.LINKEDIN_POSTS;
  const START = new Date('2026-11-23T10:00:00Z');
  const at = (hours: number) => new Date(START.getTime() + hours * HOUR);
  const board = (
    spellings: string[],
    overrides: Partial<QuerySearchBuilderRow> = {},
  ) =>
    builder({
      channel: BOARD,
      type: Arrangement.remote,
      params: { location: 'emea', roleWords: ['engineer'], spellings },
      ...overrides,
    });
  const post = (overrides: Partial<QuerySearchBuilderRow> = {}) =>
    builder({
      channel: POSTS,
      params: {
        language: 'en',
        position: 'fullstack',
        hiringWord: 'hiring',
        positionWords: ['fullstack'],
        spellings: ['react'],
        remote: true,
      },
      ...overrides,
    });
  const searches = (collector: ReturnType<typeof setup>['collector']) =>
    collector.collect.mock.calls.map(([s]) => s);
  const ids = (s: SegmentSearch) => s.queries.map((q) => q.id);
  const fixTime = (time: Date) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(time);
  };

  it('resumes hourly channels one hour back and daily channels one day back', () => {
    for (const channel of [
      Channel.LINKEDIN_JOB_BOARD,
      Channel.LINKEDIN_JOB_BOARD_CHEAP,
      Channel.LINKEDIN_JOB_BOARD_BEBITY,
      Channel.LINKEDIN_POSTS,
    ])
      expect(channelJobsConfig[channel].resumeHours).toBe(1);
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY])
      expect(channelJobsConfig[channel].resumeHours).toBe(24);
  });

  it('the A/B example', async () => {
    fixTime(START);
    // B was paused for days: its cursor is long stale.
    const a = board(['typescript', 'react'], { coveredUntil: at(-1) });
    const b = board(['typescript', 'python'], { coveredUntil: at(-72) });
    const { collection, collector, activity, segments, warn } = setup(
      [a, b],
      undefined,
      BOARD,
    );
    activity.pausedBuilders.set(BOARD, new Set([b.id]));

    await collection.collect(BOARD);

    expect(searches(collector).map(ids)).toEqual([[a.id]]);
    const first = mergedLinkedinKeyword(searches(collector)[0].queries);
    expect(first).toContain('typescript');
    expect(first).toContain('react');
    expect(first).not.toContain('python');
    expect(segments.paused.get(b.id)).toEqual(START);
    expect(segments.cursors.get(b.id)).toEqual(at(-72));

    // B's owner marks a job: the next tick B is no longer paused.
    activity.pausedBuilders.delete(BOARD);
    vi.setSystemTime(at(1));
    collector.collect.mockClear();
    const claim = vi.spyOn(segments, 'claim');
    claim.mockImplementationOnce(async (...args) => {
      // Woken before planning: B's cursor is the fresh one, until − 1h.
      expect(segments.cursors.get(b.id)).toEqual(START);
      return FakeSearchSegmentsRepository.prototype.claim.apply(segments, args);
    });
    await collection.collect(BOARD);
    expect(claim).toHaveBeenCalledTimes(1);

    expect(searches(collector).map(ids)).toEqual([[a.id, b.id]]);
    const [second] = searches(collector);
    const keyword = mergedLinkedinKeyword(second.queries);
    for (const word of ['typescript', 'react', 'python'])
      expect(keyword).toContain(word);
    // B's window starts at until − 1h, not at its stale cursor.
    expect(second.since).toEqual(START);
    expect(second.until).toEqual(at(1));
    expect(segments.paused.has(b.id)).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('was not collected for longer than'),
    );
  });

  it('runs a builder missing from the paused set', async () => {
    const a = board(['typescript']);
    const b = board(['python']);
    const late = board(['go']);
    const rows = [a, b];
    const { collection, collector, activity, queries, segments } = setup(
      rows,
      undefined,
      BOARD,
    );
    activity.pausedBuilders.set(BOARD, new Set([b.id]));
    // Published after the paused set was read: it is in no set.
    queries.listActive.mockImplementation(async () => [...rows, late]);

    const summary = await collection.collect(BOARD);

    expect(searches(collector).map(ids)).toEqual([[a.id, late.id]]);
    expect(segments.paused.has(late.id)).toBe(false);
    expect(summary).toMatchObject({ builders: 2, buildersPaused: 1 });
  });

  it('a paused-only place drops out of the plan', async () => {
    const emea = board(['typescript']);
    const morocco = board(['python'], {
      params: {
        location: 'morocco',
        roleWords: ['engineer'],
        spellings: ['python'],
      },
    });
    const { collection, collector, activity } = setup(
      [emea, morocco],
      undefined,
      BOARD,
    );
    activity.pausedBuilders.set(BOARD, new Set([morocco.id]));

    const summary = await collection.collect(BOARD);

    expect(searches(collector).map(ids)).toEqual([[emea.id]]);
    expect(summary).toMatchObject({ builders: 1, segments: 1 });
  });

  it("posts: a woken builder doesn't widen a merged post search past one hour", async () => {
    fixTime(START);
    const a = post({ coveredUntil: at(-1) });
    const b = post({ coveredUntil: at(-72) });
    const { collection, collector, segments } = setup(
      [a, b],
      undefined,
      POSTS,
      1.5,
    );
    // B was paused, and its owner is active again.
    segments.paused.set(b.id, at(-48));

    await collection.collect(POSTS);

    expect(searches(collector).map(ids)).toEqual([[a.id, b.id]]);
    const [search] = searches(collector);
    const overlap = channelJobsConfig[POSTS].window.overlapMinutes * 60_000;
    expect(search.until).toEqual(START);
    expect(search.since).toEqual(new Date(at(-1).getTime() - overlap));
  });

  it('summary counts paused and woken', async () => {
    fixTime(START);
    const plain = builder();
    const paused = builder();
    const woken = builder({ coveredUntil: at(-240) });
    const { collection, collector, activity, segments } = setup([
      plain,
      paused,
      woken,
    ]);
    activity.pausedBuilders.set(Channel.ASHBY, new Set([paused.id]));
    segments.paused.set(woken.id, at(-100));
    const read = vi.spyOn(activity, 'pausedBuilderIds');
    const mark = vi.spyOn(segments, 'markPaused');
    const wake = vi.spyOn(segments, 'wake');
    const log = vi.mocked(Logger.prototype.log);

    const summary = await collection.collect(Channel.ASHBY);

    expect(read).toHaveBeenCalledWith(Channel.ASHBY, START, 24);
    expect(mark).toHaveBeenCalledWith([paused.id], START);
    expect(wake).toHaveBeenCalledWith(
      Channel.ASHBY,
      new Set([paused.id]),
      at(-24),
    );
    expect(summary).toMatchObject({
      builders: 2,
      buildersPaused: 1,
      buildersWoken: 1,
    });
    expect(searches(collector).map(ids)).toEqual([[plain.id, woken.id]]);
    expect(segments.cursors.get(woken.id)).toEqual(START);
    expect(log).toHaveBeenCalledWith(
      'ASHBY: 2 builders runnable, 1 paused, 1 woken',
    );
  });

  it('runs the unflagged builders when the paused set cannot be read', async () => {
    const plain = builder();
    const flagged = builder({ pausedAt: new Date('2026-11-20T10:00:00Z') });
    const { collection, collector, activity, segments } = setup([
      plain,
      flagged,
    ]);
    vi.spyOn(activity, 'pausedBuilderIds').mockRejectedValue(
      new Error('relation does not exist'),
    );
    const mark = vi.spyOn(segments, 'markPaused');
    const wake = vi.spyOn(segments, 'wake');
    const error = vi.mocked(Logger.prototype.error);

    const summary = await collection.collect(Channel.ASHBY);

    expect(searches(collector).map(ids)).toEqual([[plain.id]]);
    expect(mark).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      builders: 1,
      buildersPaused: 1,
      buildersWoken: 0,
      batches: 1,
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('ASHBY: paused builders could not be read'),
    );
  });

  it('fails the tick when waking fails', async () => {
    const { collection, collector, segments } = setup([builder()]);
    vi.spyOn(segments, 'wake').mockRejectedValue(new Error('db down'));
    await expect(collection.collect(Channel.ASHBY)).rejects.toThrow('db down');
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it('counts nothing paused or woken without active builders', async () => {
    const { collection } = setup([]);
    expect(await collection.collect(Channel.ASHBY)).toMatchObject({
      builders: 0,
      buildersPaused: 0,
      buildersWoken: 0,
    });
  });
});
