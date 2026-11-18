import { Channel } from 'src/common/enums';
import { SearchNotStartedError } from '../utils/search-not-started';
import type { SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { LinkedinJobBoardBebityCollector } from './linkedin-job-board-bebity.collector';

const since = new Date('2026-10-31T11:00:00Z');
const until = new Date('2026-10-31T12:00:00Z');

function actor(count: number, costUsd: number | null = 0.1) {
  const run = vi.fn<
    (
      actor: string,
      input: Record<string, unknown>,
      options?: { maxChargeUsd: number; memoryMbytes?: number },
    ) => Promise<{ items: unknown[]; costUsd: number | null; runId: string }>
  >(async () => ({
    items: Array.from({ length: count }, (_, i) => ({ id: `j${i}` })),
    costUsd,
    runId: 'run-1',
  }));
  return { run, provider: { run } as unknown as ApifyActorProvider };
}

const member = (id: string, params: Record<string, unknown> = {}) => ({
  id,
  keyword: `kw ${id}`,
  params: {
    location: 'united states',
    roleWords: ['engineer'],
    spellings: [id],
    workType: '2',
    ...params,
  },
});

const segment = (
  queries = [member('a'), member('b')],
  extra: Partial<SegmentSearch> = {},
): SegmentSearch => ({
  channel: Channel.LINKEDIN_JOB_BOARD_BEBITY,
  since,
  until,
  queries,
  ...extra,
});

describe('LinkedinJobBoardBebityCollector', () => {
  it('has its own channel and limits', () => {
    expect(new LinkedinJobBoardBebityCollector({} as never).channel).toBe(
      Channel.LINKEDIN_JOB_BOARD_BEBITY,
    );
    expect(LinkedinJobBoardBebityCollector.config).toEqual({
      actor: 'bebity/linkedin-jobs-scraper',
      maxRunChargeUsd: 0.15,
      maxRowsPerSearch: 100,
      maxRowsCeiling: 1000,
      memoryMbytes: 1024,
    });
  });

  it('runs one search for the segment', async () => {
    const { run, provider } = actor(10);
    const result = await new LinkedinJobBoardBebityCollector(provider).collect(
      segment(),
    );
    expect(run).toHaveBeenCalledTimes(1);
    const [name, input, options] = run.mock.calls[0]!;
    expect(name).toBe('bebity/linkedin-jobs-scraper');
    expect(options).toEqual({ maxChargeUsd: 0.15, memoryMbytes: 1024 });
    expect(input).not.toHaveProperty('startUrls');
    expect(input).toMatchObject({
      titles: [expect.any(String)],
      locations: ['United States'],
      workTypes: ['2'],
      rows: 100,
    });
    expect(result).toMatchObject({
      fetched: 10,
      costUsd: 0.1,
      capped: false,
      truncatedQueryIds: [],
      searchTotals: null,
      source: { actor: 'bebity/linkedin-jobs-scraper', apifyRunId: 'run-1' },
    });
    expect(result.itemsByQuery.get('a')?.map((i) => i.rank)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
  });

  it('marks every member truncated when the row limit is reached', async () => {
    const { provider } = actor(100);
    const result = await new LinkedinJobBoardBebityCollector(provider).collect(
      segment(),
    );
    expect(result.truncatedQueryIds).toEqual(['a', 'b']);
  });

  it('does not truncate below the row limit', async () => {
    const { provider } = actor(99);
    const result = await new LinkedinJobBoardBebityCollector(provider).collect(
      segment(),
    );
    expect(result.truncatedQueryIds).toEqual([]);
  });

  it('raises the rows and the charge cap with the segment maxItems', async () => {
    const { run, provider } = actor(1000);
    const result = await new LinkedinJobBoardBebityCollector(provider).collect(
      segment([member('a')], { maxItems: 1000 }),
    );
    expect(run.mock.calls[0]![1].rows).toBe(1000);
    expect(run.mock.calls[0]![2]).toEqual({
      maxChargeUsd: 1.5,
      memoryMbytes: 1024,
    });
    expect(result.truncatedQueryIds).toEqual(['a']);
  });

  it('does not start a search whose geoId has no bebity place', async () => {
    const { run, provider } = actor(1);
    await expect(
      new LinkedinJobBoardBebityCollector(provider).collect(
        segment([member('a', { location: 'mena' })]),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses members that run different searches', async () => {
    const { run, provider } = actor(1);
    await expect(
      new LinkedinJobBoardBebityCollector(provider).collect(
        segment([member('a'), member('b', { workType: '1' })]),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });
});
