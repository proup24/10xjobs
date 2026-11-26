import { Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { SearchNotStartedError } from '../utils/search-not-started';
import type { SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { IndeedCollector } from './indeed.collector';

const since = new Date('2026-11-26T08:00:00Z');
const until = new Date('2026-11-26T09:00:00Z');

function actor(count: number, costUsd = 0.05) {
  const run = vi.fn<
    (
      actor: string,
      input: Record<string, unknown>,
      options?: { maxChargeUsd: number; waitSecs?: number },
    ) => Promise<{ items: unknown[]; costUsd: number | null; runId: string }>
  >(async () => ({
    items: Array.from({ length: count }, (_, i) => ({ id: `j${i}` })),
    costUsd,
    runId: 'run-1',
  }));
  return { run, provider: { run } as unknown as ApifyActorProvider };
}

const member = (id: string) => ({
  id,
  keyword: `kw ${id}`,
  params: {
    site: 'us',
    location: 'Remote',
    roleWords: ['backend engineer'],
    spellings: ['node'],
  },
});

const segment = (extra: Partial<SegmentSearch> = {}): SegmentSearch => ({
  channel: Channel.INDEED,
  segmentKey: 'INDEED|us|Remote',
  since,
  until,
  queries: [member('a'), member('b')],
  maxChargeUsd: 0.5,
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('IndeedCollector', () => {
  it('has the brief config', () => {
    expect(IndeedCollector.config).toEqual({
      actor: 'valig/indeed-jobs-scraper',
      maxRunChargeUsd: 0.11,
      maxRowsPerSearch: 1000,
      waitSecs: 900,
    });
  });

  it('runs the actor with the five-field input', async () => {
    const { run, provider } = actor(1);
    await new IndeedCollector(provider).collect(segment());
    const [name, input, options] = run.mock.calls[0]!;
    expect(name).toBe('valig/indeed-jobs-scraper');
    expect(Object.keys(input).sort()).toEqual([
      'country',
      'datePosted',
      'limit',
      'location',
      'title',
    ]);
    expect(input).toMatchObject({
      country: 'us',
      location: 'Remote',
      limit: 1000,
      datePosted: '1',
    });
    expect(options).toEqual({ maxChargeUsd: 0.11, waitSecs: 900 });
  });

  it('passes the smaller charge limit', async () => {
    const { run, provider } = actor(1);
    await new IndeedCollector(provider).collect(
      segment({ maxChargeUsd: 0.05 }),
    );
    expect(run.mock.calls[0]![2]).toMatchObject({ maxChargeUsd: 0.05 });
  });

  it('refuses to start without a charge limit', async () => {
    const { run, provider } = actor(1);
    await expect(
      new IndeedCollector(provider).collect(
        segment({ maxChargeUsd: undefined }),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('shares every item with every member', async () => {
    const { provider } = actor(3);
    const result = await new IndeedCollector(provider).collect(segment());
    expect(result.fetched).toBe(3);
    expect(result.unattributed).toEqual([]);
    for (const id of ['a', 'b'])
      expect(result.itemsByQuery.get(id)!.map((i) => i.rank)).toEqual([
        1, 2, 3,
      ]);
    expect(result.source).toEqual({
      actor: 'valig/indeed-jobs-scraper',
      apifyRunId: 'run-1',
    });
  });

  it('marks every member truncated at 1000 rows and warns', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { provider } = actor(1000);
    const result = await new IndeedCollector(provider).collect(segment());
    expect(result.truncatedQueryIds).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledWith(
      'INDEED segment INDEED|us|Remote returned 1000 rows, its row cap; jobs past it are lost',
    );
  });

  it('is not truncated at 999', async () => {
    const { provider } = actor(999);
    const result = await new IndeedCollector(provider).collect(segment());
    expect(result.truncatedQueryIds).toEqual([]);
  });

  it('marks a run that reached its charge limit capped', async () => {
    const { provider } = actor(5, 0.11);
    expect(
      (await new IndeedCollector(provider).collect(segment())).capped,
    ).toBe(true);
  });
});
