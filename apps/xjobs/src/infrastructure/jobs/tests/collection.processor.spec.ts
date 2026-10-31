import { Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import type { Collector, CollectedJob } from 'src/modules/collectors';
import type { IngestReport, IngestService } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { CollectionProcessor } from '../collection.processor';
import { channelJobsConfig } from '../config';

const builder = (id: string, keyword = `kw ${id}`) =>
  ({
    id,
    channel: Channel.ASHBY,
    keyword,
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

function setup(
  builders: QuerySearchBuilderRow[],
  collect: Collector['collect'] = async () => ({
    jobs: [job(1)],
    complete: true,
    truncated: false,
  }),
  ingest: IngestService['ingest'] = async () => report({ inserted: 1 }),
) {
  const queries = { listActive: vi.fn(async () => builders) };
  const collector = {
    channel: Channel.ASHBY,
    collect: vi.fn(collect),
  } as unknown as Collector & { collect: ReturnType<typeof vi.fn> };
  const other = {
    channel: Channel.GREEN_HOUSE,
    collect: vi.fn(),
  } as unknown as Collector;
  const ingestService = { ingest: vi.fn(ingest) };
  const processor = new CollectionProcessor(
    queries as unknown as QuerySearchService,
    [other, collector],
    ingestService as unknown as IngestService,
  );
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  return { processor, queries, collector, ingest: ingestService.ingest, warn };
}

afterEach(() => vi.restoreAllMocks());

describe('CollectionProcessor', () => {
  it('collects each active builder once, in order, and ingests it against the builder', async () => {
    const rows = [builder('qs-1'), builder('qs-2')];
    const { processor, queries, collector, ingest } = setup(rows);

    await processor.run(Channel.ASHBY);

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
    const { processor, ingest } = setup([builder('qs-1')], async () => ({
      jobs: jobs(2500),
      complete: true,
      truncated: false,
    }));
    await processor.run(Channel.ASHBY);
    expect(ingest.mock.calls.map(([batch]) => batch.items.length)).toEqual([
      1000, 1000, 500,
    ]);
  });

  it.each(['collect', 'ingest'] as const)(
    'keeps going when one builder fails to %s',
    async (stage) => {
      const rows = [builder('qs-1'), builder('qs-2'), builder('qs-3')];
      const fail = (id: string) => {
        if (id === 'qs-2') throw new Error('boom');
      };
      const { processor, collector, warn } = setup(
        rows,
        async (search) => {
          if (stage === 'collect') fail(search.id);
          return { jobs: [job(1)], complete: true, truncated: false };
        },
        async (batch) => {
          if (stage === 'ingest') fail(batch.queryId);
          return report({ inserted: 1 });
        },
      );
      const summary = await processor.run(Channel.ASHBY);
      expect(summary).toMatchObject({ builders: 3, succeeded: 2, failed: 1 });
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
    const { processor } = setup(
      [builder('qs-1'), builder('qs-2')],
      async () => results.shift() ?? results[0],
      async () => reports.shift() ?? report(),
    );
    expect(await processor.run(Channel.ASHBY)).toEqual({
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
    const { processor } = setup(
      [builder('qs-1'), builder('qs-2')],
      async () => {
        throw new Error('down');
      },
    );
    await expect(processor.run(Channel.ASHBY)).rejects.toThrow(/ASHBY.*2/);
  });

  it('succeeds without calling Apify or ingest when there are no builders', async () => {
    const { processor, collector, ingest } = setup([]);
    expect(await processor.run(Channel.ASHBY)).toMatchObject({
      builders: 0,
      failed: 0,
    });
    expect(collector.collect).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects at once when the channel has no collector', async () => {
    const { processor, queries } = setup([builder('qs-1')]);
    await expect(processor.run(Channel.LINKEDIN_POSTS)).rejects.toThrow(
      /LINKEDIN_POSTS/,
    );
    expect(queries.listActive).not.toHaveBeenCalled();
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
