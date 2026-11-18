import { Channel } from 'src/common/enums';
import { SearchNotStartedError } from '../utils/search-not-started';
import type { SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { LinkedinJobBoardCheapCollector } from './linkedin-job-board-cheap.collector';
import { linkedinGeoId } from './mappers/linkedin-job-board.mapper';

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
    location: 'morocco',
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
  channel: Channel.LINKEDIN_JOB_BOARD_CHEAP,
  since,
  until,
  queries,
  ...extra,
});

describe('LinkedinJobBoardCheapCollector', () => {
  it('has its own channel and limits', () => {
    expect(new LinkedinJobBoardCheapCollector({} as never).channel).toBe(
      Channel.LINKEDIN_JOB_BOARD_CHEAP,
    );
    expect(LinkedinJobBoardCheapCollector.config).toEqual({
      actor: 'cheap_scraper/linkedin-job-scraper',
      maxRunChargeUsd: 0.15,
      memoryMbytes: 1024,
      maxRowsPerSearch: 100,
      maxRowsCeiling: 1000,
    });
  });

  it('runs one search for the segment with the resolved geoId', async () => {
    const { run, provider } = actor(10);
    const result = await new LinkedinJobBoardCheapCollector(provider).collect(
      segment(),
    );
    expect(run).toHaveBeenCalledTimes(1);
    const [name, input, options] = run.mock.calls[0]!;
    expect(name).toBe('cheap_scraper/linkedin-job-scraper');
    expect(options).toEqual({ maxChargeUsd: 0.15, memoryMbytes: 1024 });
    expect(input).toEqual({
      startUrls: [{ url: expect.any(String) }],
      maxItems: 100,
      saveOnlyUniqueItems: false,
      enrichCompanyData: false,
    });
    const url = new URL((input.startUrls as { url: string }[])[0]!.url);
    expect(url.searchParams.get('geoId')).toBe(
      linkedinGeoId({ location: 'morocco' }),
    );
    expect(url.searchParams.has('location')).toBe(false);
    expect(url.searchParams.get('sortBy')).toBe('DD');
    expect(url.searchParams.get('f_TPR')).toBe('r3600');
    expect(result).toMatchObject({
      fetched: 10,
      costUsd: 0.1,
      capped: false,
      truncatedQueryIds: [],
      source: {
        actor: 'cheap_scraper/linkedin-job-scraper',
        apifyRunId: 'run-1',
      },
    });
    expect(result.itemsByQuery.get('a')?.map((i) => i.rank)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
  });

  it('marks every member truncated when the row limit is reached, and reports no totals', async () => {
    const { provider } = actor(100);
    const result = await new LinkedinJobBoardCheapCollector(provider).collect(
      segment(),
    );
    expect(result.truncatedQueryIds).toEqual(['a', 'b']);
    expect(result.searchTotals ?? null).toBeNull();
  });

  it('does not truncate below the row limit', async () => {
    const { provider } = actor(40);
    const result = await new LinkedinJobBoardCheapCollector(provider).collect(
      segment(),
    );
    expect(result.truncatedQueryIds).toEqual([]);
  });

  it('raises the rows and the charge cap with the segment maxItems', async () => {
    const { run, provider } = actor(1000);
    const result = await new LinkedinJobBoardCheapCollector(provider).collect(
      segment([member('a')], { maxItems: 1000 }),
    );
    expect(run.mock.calls[0]![1].maxItems).toBe(1000);
    expect(run.mock.calls[0]![2]).toEqual({
      maxChargeUsd: 1.5,
      memoryMbytes: 1024,
    });
    expect(result.truncatedQueryIds).toEqual(['a']);
  });

  it('refuses a place with no geoId before any Apify call', async () => {
    const { run, provider } = actor(1);
    await expect(
      new LinkedinJobBoardCheapCollector(provider).collect(
        segment([member('a', { location: 'asia pacific' })]),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses members that run different searches', async () => {
    const { run, provider } = actor(1);
    await expect(
      new LinkedinJobBoardCheapCollector(provider).collect(
        segment([member('a'), member('b', { workType: '1' })]),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });
});
