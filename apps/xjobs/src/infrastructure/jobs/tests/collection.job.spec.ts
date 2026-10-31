import { Logger } from '@nestjs/common';
import { Arrangement, Channel, Region, SkillDomain } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import type {
  AshbyCollector,
  CollectedJob,
  SegmentResult,
  SegmentSearch,
} from 'src/modules/collectors';
import type { IngestReport, IngestService } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { FakeSearchSegmentsRepository } from 'src/modules/segments/testing/fakes';
import { AshbyCollectionJob } from '../collection/ashby.job';
import { GreenhouseCollectionJob } from '../collection/greenhouse.job';
import { LinkedinJobBoardCollectionJob } from '../collection/linkedin-job-board.job';
import { LinkedinPostsCollectionJob } from '../collection/linkedin-posts.job';
import { channelJobsConfig } from '../config';

let n = 0;
const builder = (overrides: Partial<QuerySearchBuilderRow> = {}) =>
  ({
    id: `qs-${String(++n).padStart(3, '0')}`,
    hash: `h-${String(n).padStart(3, '0')}`,
    channel: Channel.ASHBY,
    domain: SkillDomain.backend,
    type: Arrangement.remote,
    locationRegion: Region.EMEA,
    country: null,
    city: null,
    keyword: `kw ${n}`,
    params: { remote: true },
    coveredUntil: null,
    ...overrides,
  }) as unknown as QuerySearchBuilderRow;
const builders = (
  count: number,
  overrides: Partial<QuerySearchBuilderRow> = {},
) => Array.from({ length: count }, () => builder(overrides));

const job = (n: number) => ({ sourceJobId: `j${n}` }) as CollectedJob;
const jobs = (count: number) => Array.from({ length: count }, (_, i) => job(i));

const report = (overrides: Partial<IngestReport> = {}): IngestReport => ({
  inserted: 0,
  updated: 0,
  duplicate: 0,
  invalid: 0,
  jobIds: [],
  errors: [],
  ...overrides,
});

/** One job per member unless `perMember` says otherwise. */
const resultFor = (
  segment: SegmentSearch,
  perMember: (id: string) => CollectedJob[] = () => [job(1)],
  extra: Partial<SegmentResult> = {},
): SegmentResult => ({
  jobsByQuery: new Map(segment.queries.map((q) => [q.id, perMember(q.id)])),
  fetched: segment.queries.length,
  costUsd: 0.1,
  capped: false,
  truncatedQueryIds: [],
  ...extra,
});

function setup(
  rows: QuerySearchBuilderRow[],
  collect: (segment: SegmentSearch) => Promise<SegmentResult> = async (s) =>
    resultFor(s),
  ingest: IngestService['ingest'] = async () => report({ inserted: 1 }),
) {
  const queries = { listActive: vi.fn(async () => rows) };
  const collector = {
    channel: Channel.ASHBY,
    collect: vi.fn((segment: SegmentSearch, _config: unknown) =>
      collect(segment),
    ),
  };
  const ingestService = { ingest: vi.fn(ingest) };
  const segments = new FakeSearchSegmentsRepository();
  const ashby = new AshbyCollectionJob(
    collector as unknown as AshbyCollector,
    queries as unknown as QuerySearchService,
    ingestService as unknown as IngestService,
    segments,
  );
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  return {
    ashby,
    queries,
    collector,
    ingest: ingestService.ingest,
    segments,
    warn,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('each channel has its own collection job', () => {
  it.each([
    [
      LinkedinJobBoardCollectionJob,
      Channel.LINKEDIN_JOB_BOARD,
      'collect-linkedin-job-board',
    ],
    [
      LinkedinPostsCollectionJob,
      Channel.LINKEDIN_POSTS,
      'collect-linkedin-posts',
    ],
    [GreenhouseCollectionJob, Channel.GREEN_HOUSE, 'collect-greenhouse'],
    [AshbyCollectionJob, Channel.ASHBY, 'collect-ashby'],
  ] as const)(
    '%o collects %s on queue %s with its own config',
    (Job, channel, queueName) => {
      const instance = new Job(
        { channel } as never,
        {} as never,
        {} as never,
        new FakeSearchSegmentsRepository(),
      );
      expect(instance.channel).toBe(channel);
      expect(instance.queueName).toBe(queueName);
      expect(instance.config).toBe(channelJobsConfig[channel]);
    },
  );
});

describe('CollectionJob.run', () => {
  it('runs the collector once per segment of up to 10 builders', async () => {
    const rows = builders(12);
    const { ashby, queries, collector } = setup(rows);
    const summary = await ashby.run();

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

  it('ingests each member against its own builder in batches of 1000', async () => {
    const rows = builders(2);
    const { ashby, ingest } = setup(rows, async (s) =>
      resultFor(s, (id) => (id === rows[0].id ? jobs(2500) : [job(9)])),
    );
    await ashby.run();
    const batches = ingest.mock.calls.map(([batch]) => batch);
    expect(batches.map((b) => [b.queryId, b.items.length])).toEqual([
      [rows[0].id, 1000],
      [rows[0].id, 1000],
      [rows[0].id, 500],
      [rows[1].id, 1],
    ]);
    expect(batches.every((b) => b.channel === Channel.ASHBY)).toBe(true);
    expect(new Set(batches.map((b) => b.observedAt)).size).toBe(1);
  });

  it('advances cursors only for members whose results were ingested', async () => {
    const rows = builders(3);
    const { ashby, segments } = setup(rows, undefined, async (batch) => {
      if (batch.queryId === rows[1].id) throw new Error('db down');
      return report({ inserted: 1 });
    });
    await ashby.run();
    expect([...segments.cursors.keys()].sort()).toEqual([
      rows[0].id,
      rows[2].id,
    ]);
    const [run] = segments.runs;
    expect(run.status).toBe('partial');
    expect(run.windowEnd).toEqual(segments.cursors.get(rows[0].id));
    expect(run.perQuery[rows[1].id].error).toContain('db down');
    expect(run.perQuery[rows[0].id]).toMatchObject({
      returned: 1,
      inserted: 1,
    });
  });

  it('records a succeeded run with the segment, window, cost and truncation', async () => {
    const rows = builders(2);
    const { ashby, segments } = setup(rows, async (s) =>
      resultFor(s, undefined, {
        costUsd: 0.123456,
        truncatedQueryIds: [rows[1].id],
        fetched: 5,
      }),
    );
    await ashby.run();
    expect(segments.runs).toHaveLength(1);
    expect(segments.runs[0]).toMatchObject({
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
    expect(segments.runs[0].segmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a failed segment and keeps going with the next one', async () => {
    const rows = [
      ...builders(1, { domain: SkillDomain.backend }),
      ...builders(1, { domain: SkillDomain.frontend }),
    ];
    let calls = 0;
    const { ashby, segments, warn } = setup(rows, async (s) => {
      if (calls++ === 0) throw new Error('Apify run FAILED');
      return resultFor(s);
    });
    const summary = await ashby.run();
    expect(segments.runs.map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(segments.runs[0].error).toContain('Apify run FAILED');
    expect(segments.cursors.size).toBe(1);
    expect(summary).toMatchObject({ segments: 2, segmentsFailed: 1 });
    expect(warn).toHaveBeenCalled();
  });

  it('marks a segment failed when every member failed to ingest', async () => {
    const { ashby, segments } = setup(builders(2), undefined, async () => {
      throw new Error('db down');
    });
    await expect(ashby.run()).rejects.toThrow(/ASHBY/);
    expect(segments.runs[0].status).toBe('failed');
    expect(segments.cursors.size).toBe(0);
  });

  it('does not advance cursors of a run stopped by its charge cap', async () => {
    const { ashby, segments } = setup(builders(2), async (s) =>
      resultFor(s, undefined, { capped: true }),
    );
    await ashby.run();
    expect(segments.runs[0]).toMatchObject({
      capped: true,
      status: 'succeeded',
    });
    expect(segments.cursors.size).toBe(0);
  });

  it('fails the job only when every segment failed', async () => {
    const { ashby } = setup(builders(2), async () => {
      throw new Error('down');
    });
    await expect(ashby.run()).rejects.toThrow(/ASHBY.*1/);
  });

  it('does nothing without active builders', async () => {
    const { ashby, collector, segments } = setup([]);
    expect(await ashby.run()).toMatchObject({ builders: 0, segments: 0 });
    expect(collector.collect).not.toHaveBeenCalled();
    expect(segments.runs).toEqual([]);
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
