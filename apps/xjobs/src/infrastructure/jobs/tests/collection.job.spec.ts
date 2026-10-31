import { Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { RedisConfig } from 'src/config';
import type { QuerySearchBuilderRow } from 'src/database';
import type {
  AshbyCollector,
  CollectedJob,
  CollectionResult,
  CollectorSearch,
} from 'src/modules/collectors';
import type { IngestReport, IngestService } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { AshbyCollectionJob } from '../collection/ashby.job';
import { syncCollectionScheduler } from '../collection/collection.job';
import { GreenhouseCollectionJob } from '../collection/greenhouse.job';
import { LinkedinJobBoardCollectionJob } from '../collection/linkedin-job-board.job';
import { LinkedinPostsCollectionJob } from '../collection/linkedin-posts.job';
import { channelJobsConfig } from '../config';

const builder = (id: string) =>
  ({
    id,
    channel: Channel.ASHBY,
    keyword: `kw ${id}`,
    params: { remote: true },
  }) as unknown as QuerySearchBuilderRow;

const job = (n: number) => ({ sourceJobId: `j${n}` }) as CollectedJob;
const jobs = (count: number) => Array.from({ length: count }, (_, n) => job(n));

const report = (overrides: Partial<IngestReport> = {}): IngestReport => ({
  inserted: 0,
  updated: 0,
  duplicate: 0,
  invalid: 0,
  jobIds: [],
  errors: [],
  ...overrides,
});

const redis = { url: 'redis://127.0.0.1:1', prefix: 'test' } as RedisConfig;

function setup(
  builders: QuerySearchBuilderRow[],
  collect: (
    search: CollectorSearch,
  ) => Promise<CollectionResult> = async () => ({
    jobs: [job(1)],
    complete: true,
    truncated: false,
  }),
  ingest: IngestService['ingest'] = async () => report({ inserted: 1 }),
) {
  const queries = { listActive: vi.fn(async () => builders) };
  const collector = { channel: Channel.ASHBY, collect: vi.fn(collect) };
  const ingestService = { ingest: vi.fn(ingest) };
  const ashby = new AshbyCollectionJob(
    collector as unknown as AshbyCollector,
    queries as unknown as QuerySearchService,
    ingestService as unknown as IngestService,
    redis,
  );
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  return { ashby, queries, collector, ingest: ingestService.ingest, warn };
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
  ] as const)('%o collects %s on queue %s', (Job, channel, queueName) => {
    const instance = new Job(
      { channel } as never,
      {} as never,
      {} as never,
      redis,
    );
    expect(instance.channel).toBe(channel);
    expect(instance.queueName).toBe(queueName);
  });
});

describe('AshbyCollectionJob.run', () => {
  it('collects each active builder once, in order, and ingests it against the builder', async () => {
    const { ashby, queries, collector, ingest } = setup([
      builder('qs-1'),
      builder('qs-2'),
    ]);

    await ashby.run();

    expect(queries.listActive).toHaveBeenCalledTimes(1);
    expect(queries.listActive).toHaveBeenCalledWith(Channel.ASHBY);
    expect(collector.collect.mock.calls.map(([search]) => search)).toEqual([
      {
        id: 'qs-1',
        channel: Channel.ASHBY,
        keyword: 'kw qs-1',
        params: { remote: true },
      },
      {
        id: 'qs-2',
        channel: Channel.ASHBY,
        keyword: 'kw qs-2',
        params: { remote: true },
      },
    ]);
    const batches = ingest.mock.calls.map(([batch]) => batch);
    expect(batches.map((batch) => batch.queryId)).toEqual(['qs-1', 'qs-2']);
    expect(batches.every((batch) => batch.channel === Channel.ASHBY)).toBe(
      true,
    );
    expect(batches[0].items).toEqual([job(1)]);
    expect(batches[0].observedAt).toBeInstanceOf(Date);
    expect(batches[1].observedAt).toBe(batches[0].observedAt);
  });

  it('ingests large results in chunks of at most 1000 items', async () => {
    const { ashby, ingest } = setup([builder('qs-1')], async () => ({
      jobs: jobs(2500),
      complete: true,
      truncated: false,
    }));
    await ashby.run();
    expect(ingest.mock.calls.map(([batch]) => batch.items.length)).toEqual([
      1000, 1000, 500,
    ]);
  });

  it.each(['collect', 'ingest'] as const)(
    'keeps going when one builder fails to %s',
    async (stage) => {
      const fail = (id: string) => {
        if (id === 'qs-2') throw new Error('boom');
      };
      const { ashby, collector, warn } = setup(
        [builder('qs-1'), builder('qs-2'), builder('qs-3')],
        async (search) => {
          if (stage === 'collect') fail(search.id);
          return { jobs: [job(1)], complete: true, truncated: false };
        },
        async (batch) => {
          if (stage === 'ingest') fail(batch.queryId);
          return report({ inserted: 1 });
        },
      );
      expect(await ashby.run()).toMatchObject({
        builders: 3,
        succeeded: 2,
        failed: 1,
      });
      expect(collector.collect).toHaveBeenCalledTimes(3);
      expect(
        warn.mock.calls.some(([message]) => String(message).includes('qs-2')),
      ).toBe(true);
    },
  );

  it('sums collection and ingest counts into the summary', async () => {
    const results = [
      { jobs: [job(1), job(2)], complete: true, truncated: true },
      { jobs: [job(3)], complete: false, truncated: false },
    ];
    const reports = [
      report({ inserted: 1, duplicate: 1 }),
      report({ updated: 1, invalid: 2 }),
    ];
    const { ashby } = setup(
      [builder('qs-1'), builder('qs-2')],
      async () =>
        results.shift() ?? { jobs: [], complete: true, truncated: false },
      async () => reports.shift() ?? report(),
    );
    expect(await ashby.run()).toEqual({
      channel: Channel.ASHBY,
      builders: 2,
      succeeded: 2,
      failed: 0,
      collected: 3,
      truncated: 1,
      incomplete: 1,
      inserted: 1,
      updated: 1,
      duplicate: 1,
      invalid: 2,
    });
  });

  it('fails the run when every builder failed', async () => {
    const { ashby } = setup([builder('qs-1'), builder('qs-2')], async () => {
      throw new Error('down');
    });
    await expect(ashby.run()).rejects.toThrow(/ASHBY.*2/);
  });

  it('succeeds without collecting or ingesting when there are no builders', async () => {
    const { ashby, collector, ingest } = setup([]);
    expect(await ashby.run()).toMatchObject({ builders: 0, failed: 0 });
    expect(collector.collect).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('syncCollectionScheduler', () => {
  const queue = () => ({
    upsertJobScheduler: vi.fn(async () => undefined),
    removeJobScheduler: vi.fn(async () => true),
  });

  it("upserts the channel's cron scheduler when enabled", async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(
        q as never,
        channelJobsConfig[Channel.ASHBY],
      ),
    ).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'collect',
      { pattern: '0 * * * *', tz: 'UTC' },
      { name: 'collect', opts: { attempts: 1 } },
    );
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('removes the scheduler when the channel is disabled', async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(q as never, {
        ...channelJobsConfig[Channel.ASHBY],
        enabled: false,
      }),
    ).toBe('removed');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('collect');
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  });
});

describe('channelJobsConfig', () => {
  it('gives every channel its own hourly, single-run config', () => {
    for (const channel of Object.values(Channel)) {
      expect(channelJobsConfig[channel]).toEqual({
        enabled: true,
        schedule: { pattern: '0 * * * *', timezone: 'UTC' },
        concurrency: 1,
        attempts: 1,
      });
    }
  });
});
