import { Channel } from 'src/common/enums';
import { SearchNotStartedError } from '../utils/search-not-started';
import type { SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { LinkedinPostsCollector } from './linkedin-posts.collector';

const since = new Date('2026-11-20T05:00:00Z');
const until = new Date('2026-11-20T06:00:00Z');

function actor(count: number, log: string | null = '', costUsd = 0.1) {
  const run = vi.fn<
    (
      actor: string,
      input: Record<string, unknown>,
      options?: { maxChargeUsd: number; waitSecs?: number },
    ) => Promise<{ items: unknown[]; costUsd: number | null; runId: string }>
  >(async () => ({
    items: Array.from({ length: count }, (_, i) => ({ id: `p${i}` })),
    costUsd,
    runId: 'run-1',
  }));
  const runLog = vi.fn(async () => log);
  return {
    run,
    runLog,
    provider: { run, runLog } as unknown as ApifyActorProvider,
  };
}

const member = (id: string) => ({
  id,
  keyword: `kw ${id}`,
  params: {
    hiringWord: 'hiring',
    positionWords: ['fullstack', 'full stack'],
    spellings: ['react', 'reactjs'],
    remote: true,
  },
});

const segment = (extra: Partial<SegmentSearch> = {}): SegmentSearch => ({
  channel: Channel.LINKEDIN_POSTS,
  since,
  until,
  queries: [member('a'), member('b')],
  maxChargeUsd: 0.4,
  ...extra,
});

describe('LinkedinPostsCollector', () => {
  it('sends one merged search over the segment window', async () => {
    const { run, provider } = actor(2);
    await new LinkedinPostsCollector(provider).collect(segment());
    expect(run).toHaveBeenCalledTimes(1);
    const [name, input, options] = run.mock.calls[0]!;
    expect(name).toBe('harvestapi/linkedin-post-search');
    expect(input).toEqual({
      searchQueries: [
        'hiring (fullstack OR "full stack") (react OR reactjs) remote',
      ],
      maxPosts: 0,
      postedLimitDate: since.toISOString(),
      sortBy: 'date',
      profileScraperMode: 'short',
    });
    expect(options).toEqual({ maxChargeUsd: 0.4, waitSecs: 900 });
  });

  it('credits every post to every member', async () => {
    const { provider } = actor(3);
    const result = await new LinkedinPostsCollector(provider).collect(
      segment(),
    );
    expect(result.fetched).toBe(3);
    for (const id of ['a', 'b'])
      expect(result.itemsByQuery.get(id)!.map((i) => i.rank)).toEqual([
        1, 2, 3,
      ]);
    expect(result.truncatedQueryIds).toEqual([]);
    expect(result.incomplete).toBeNull();
  });

  it('marks a run with no available resource incomplete', async () => {
    const { provider } = actor(
      2,
      'Error scraping item#1 {}: No available resource',
    );
    const result = await new LinkedinPostsCollector(provider).collect(
      segment(),
    );
    expect(result.incomplete).toBe('no available resource');
    expect(result.fetched).toBe(2);
  });

  it('does not start without a charge limit', async () => {
    const { run, provider } = actor(1);
    await expect(
      new LinkedinPostsCollector(provider).collect(
        segment({ maxChargeUsd: undefined }),
      ),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });
});
