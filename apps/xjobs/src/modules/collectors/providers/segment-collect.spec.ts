import { Channel } from 'src/common/enums';
import type { BoardSearchRunConfig, SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { GoogleJobsSearchProvider } from './apify/google-search.provider';
import { LinkedinJobBoardCollector } from './linkedin-job-board.collector';
import { boardQuery } from './mappers/google-search.mapper';
import {
  linkedinJobSearchUrl,
  linkedinSearch,
} from './mappers/linkedin-job-board.mapper';
import { LinkedinPostsCollector } from './linkedin-posts.collector';
import { AshbyCollector } from './ashby.collector';
import type { AshbyPostingProvider } from './extraction/ashby.provider';

const until = new Date('2026-10-31T12:00:00Z');
const since = new Date('2026-10-31T10:00:00Z');

function actor(
  items: (input: Record<string, unknown>) => unknown[],
  costUsd: number | null = 0.2,
) {
  const run = vi.fn<
    (
      actor: string,
      input: Record<string, unknown>,
      options?: { maxChargeUsd: number },
    ) => Promise<{ items: unknown[]; costUsd: number | null; runId: string }>
  >(async (_actor, input) => ({
    items: items(input),
    costUsd,
    runId: 'run-1',
  }));
  return { run, provider: { run } as unknown as ApifyActorProvider };
}

const segment = (
  channel: Channel,
  queries: SegmentSearch['queries'],
): SegmentSearch => ({ channel, since, until, queries });

const board = LinkedinJobBoardCollector.config;
const posts = LinkedinPostsCollector.config;
const ashby: BoardSearchRunConfig = {
  actor: 'apify/google-search-scraper',
  maxRunChargeUsd: 1,
  site: 'jobs.ashbyhq.com',
  suffix: 'intitle:engineer',
  maxPagesPerQuery: 3,
};

describe('linkedinJobSearchUrl', () => {
  it('searches the keyword with the builder filters, newest first, in the window', () => {
    const url = new URL(
      linkedinJobSearchUrl(
        'senior backend engineer nestjs',
        { location: 'EMEA', experienceLevel: '4', workType: '2' },
        7200,
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/jobs/search/',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keywords: 'senior backend engineer nestjs',
      location: 'EMEA',
      f_E: '4',
      f_WT: '2',
      sortBy: 'DD',
      f_TPR: 'r7200',
    });
  });

  it('pins the location with a geoId when the builder has one', () => {
    const url = new URL(
      linkedinJobSearchUrl(
        '("backend engineer" OR "backend developer") AND nestjs',
        { location: 'EMEA', geoId: '91000007' },
        60,
      ),
    );
    expect(url.searchParams.get('geoId')).toBe('91000007');
    expect(url.searchParams.get('location')).toBe('EMEA');
    expect(url.searchParams.get('keywords')).toBe(
      '("backend engineer" OR "backend developer") AND nestjs',
    );
  });

  it('sends GLOBAL as Worldwide and omits missing filters', () => {
    const url = new URL(linkedinJobSearchUrl('x', { location: 'GLOBAL' }, 60));
    expect(url.searchParams.get('location')).toBe('Worldwide');
    expect(url.searchParams.has('f_E')).toBe(false);
    expect(url.searchParams.has('f_WT')).toBe(false);
    expect(url.href).not.toContain('undefined');
  });
});

describe('linkedinSearch', () => {
  it('is the keyword, the geoId before the location text, and the filters', () => {
    expect(linkedinSearch('backend go', { location: 'Germany' })).toBe(
      'keywords=backend+go&location=Germany',
    );
    expect(linkedinSearch('x', { location: 'GLOBAL' })).toBe(
      'keywords=x&location=Worldwide',
    );
    expect(
      linkedinSearch('x', {
        location: 'uae',
        geoId: '104305776',
        experienceLevel: '4',
        workType: '2',
      }),
    ).toBe(
      linkedinSearch('x', {
        location: 'united arab emirates',
        geoId: '104305776',
        experienceLevel: '4',
        workType: '2',
      }),
    );
  });
});

describe('LinkedIn job board segment', () => {
  const queries = [
    { id: 'qs-1', keyword: 'backend nestjs', params: { location: 'Germany' } },
    { id: 'qs-2', keyword: 'backend nestjs', params: { location: 'Germany' } },
  ];
  const url = linkedinJobSearchUrl(queries[0].keyword, queries[0].params, 7200);
  const item = (jobId: number, searchString?: string) => ({
    jobId: String(jobId),
    jobUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
    jobTitle: 'Engineer',
    companyName: 'Acme',
    publishedAt: '2026-10-31T00:00:00.000Z',
    jobDescription: 'Build & ship',
    searchString,
  });

  it('runs its one search and gives every member every item, in dataset order', async () => {
    // The echoed search is never read: LinkedIn may rewrite the location.
    const { run, provider } = actor(() => [
      item(1, 'backend nestjs - Deutschland'),
      item(2),
    ]);
    const result = await new LinkedinJobBoardCollector(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe('cheap_scraper/linkedin-job-scraper');
    expect(run.mock.calls[0][1]).toEqual({
      startUrls: [{ url }],
      maxItems: board.maxRowsPerUrl,
      saveOnlyUniqueItems: false,
      enrichCompanyData: false,
    });
    expect(run.mock.calls[0][2]).toEqual({
      maxChargeUsd: board.maxRunChargeUsd,
    });
    const expected = [
      { rank: 1, payload: item(1, 'backend nestjs - Deutschland') },
      { rank: 2, payload: item(2) },
    ];
    expect(result.itemsByQuery.get('qs-1')).toEqual(expected);
    expect(result.itemsByQuery.get('qs-2')).toEqual(expected);
    expect(result.unattributed).toEqual([]);
    expect(result.fetched).toBe(2);
    expect(result.truncatedQueryIds).toEqual([]);
    expect(result.source).toEqual({
      actor: 'cheap_scraper/linkedin-job-scraper',
      apifyRunId: 'run-1',
    });
  });

  it('runs members that spell a geoId-pinned place differently as one search', async () => {
    const pinned = [
      {
        id: 'qs-a',
        keyword: 'go',
        params: { location: 'uae', geoId: '104305776' },
      },
      {
        id: 'qs-b',
        keyword: 'go',
        params: { location: 'united arab emirates', geoId: '104305776' },
      },
    ];
    const { run, provider } = actor(() => [item(1)]);
    const result = await new LinkedinJobBoardCollector(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, pinned),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      (run.mock.calls[0][1] as { startUrls: unknown[] }).startUrls,
    ).toHaveLength(1);
    expect(result.itemsByQuery.get('qs-a')).toHaveLength(1);
    expect(result.itemsByQuery.get('qs-b')).toHaveLength(1);
  });

  it('refuses a segment whose members run different searches', async () => {
    const { run, provider } = actor(() => [item(1)]);
    await expect(
      new LinkedinJobBoardCollector(provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, [
          { id: 'qs-a', keyword: 'go', params: { location: 'EMEA' } },
          {
            id: 'qs-b',
            keyword: 'go',
            params: { location: 'EMEA', workType: '2' },
          },
        ]),
      ),
    ).rejects.toThrow(/one search/);
    expect(run).not.toHaveBeenCalled();
  });

  it('counts the search as truncated when it returned its row limit', async () => {
    const full = Array.from({ length: board.maxRowsPerUrl }, (_, i) =>
      item(100 + i),
    );
    const result = await new LinkedinJobBoardCollector(
      actor(() => full).provider,
    ).collect(segment(Channel.LINKEDIN_JOB_BOARD, queries));
    expect(result.truncatedQueryIds).toEqual(['qs-1', 'qs-2']);
    expect(result.itemsByQuery.get('qs-1')?.at(-1)?.rank).toBe(
      board.maxRowsPerUrl,
    );

    const short = await new LinkedinJobBoardCollector(
      actor(() => full.slice(1)).provider,
    ).collect(segment(Channel.LINKEDIN_JOB_BOARD, queries));
    expect(short.truncatedQueryIds).toEqual([]);
  });

  it("keeps the run's search totals, untouched", async () => {
    const totals = { [url]: 41 };
    const record = vi.fn(async () => totals);
    const run = vi.fn(async () => ({
      items: [],
      costUsd: 0.1,
      runId: 'run-1',
      keyValueStoreId: 'kv-1',
    }));
    const result = await new LinkedinJobBoardCollector({
      run,
      record,
    } as unknown as ApifyActorProvider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(record).toHaveBeenCalledWith('kv-1', 'SEARCH_TOTALS');
    expect(result.searchTotals).toEqual(totals);
  });

  it('stores no totals when LinkedIn exposed none, and still succeeds', async () => {
    for (const record of [
      vi.fn(async () => null),
      vi.fn(async () => {
        throw new Error('store unavailable');
      }),
    ]) {
      const result = await new LinkedinJobBoardCollector({
        run: vi.fn(async () => ({
          items: [],
          costUsd: 0.1,
          runId: 'run-1',
          keyValueStoreId: 'kv-1',
        })),
        record,
      } as unknown as ApifyActorProvider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, queries),
      );
      expect(result.searchTotals).toBeNull();
    }
  });

  it('reports the cost and whether the charge cap was reached', async () => {
    const atCap = board.maxRunChargeUsd * 0.96;
    const capped = await new LinkedinJobBoardCollector(
      actor(() => [], atCap).provider,
    ).collect(segment(Channel.LINKEDIN_JOB_BOARD, queries));
    expect(capped).toMatchObject({ costUsd: atCap, capped: true });

    const unknown = await new LinkedinJobBoardCollector(
      actor(() => [], null).provider,
    ).collect(segment(Channel.LINKEDIN_JOB_BOARD, queries));
    expect(unknown).toMatchObject({ costUsd: null, capped: false });
  });
});

describe('LinkedIn posts segment', () => {
  it('runs once with every query from the window start and attributes posts', async () => {
    const queries = [
      { id: 'qs-1', keyword: 'hiring backend nestjs remote', params: {} },
      { id: 'qs-2', keyword: 'hiring backend go remote', params: {} },
      { id: 'qs-3', keyword: 'hiring backend java remote', params: {} },
    ];
    const post = (id: string, search: string) => ({
      id,
      linkedinUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`,
      content: '\nWe are hiring\nengineers',
      author: {
        name: 'Jane',
        type: 'profile',
        linkedinUrl: 'https://www.linkedin.com/in/jane',
      },
      postedAt: { date: '2026-10-31T11:00:00Z' },
      query: { search },
    });
    // qs-2 fills its post limit, so it is reported truncated.
    const full = Array.from({ length: posts.maxPostsPerQuery }, (_, i) =>
      post(String(100 + i), queries[1].keyword),
    );
    const { run, provider } = actor(() => [
      ...full,
      post('9', 'unknown query'),
    ]);
    const result = await new LinkedinPostsCollector(provider).collect(
      segment(Channel.LINKEDIN_POSTS, queries),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({
      searchQueries: queries.map((q) => q.keyword),
      maxPosts: posts.maxPostsPerQuery,
      postedLimitDate: since.toISOString(),
      sortBy: 'date',
    });
    expect(result.itemsByQuery.get('qs-2')).toEqual(
      full.map((payload) => ({ rank: null, payload })),
    );
    expect(result.itemsByQuery.get('qs-1')).toEqual([]);
    expect(result.unattributed).toEqual([
      { rank: null, payload: post('9', 'unknown query') },
    ]);
    expect(result.truncatedQueryIds).toEqual(['qs-2']);
    expect(result.fetched).toBe(posts.maxPostsPerQuery + 1);
    expect(result.source).toEqual({ actor: posts.actor, apifyRunId: 'run-1' });
  });
});

describe('job board segments on Google', () => {
  const titles = '("backend engineer" OR "backend developer")';

  it('adds the site and suffix to the builder query without requoting it', () => {
    expect(boardQuery(`${titles} nestjs senior "remote"`, ashby)).toBe(
      `site:jobs.ashbyhq.com ${titles} nestjs senior "remote" intitle:engineer`,
    );
    expect(boardQuery(`${titles} nestjs`, { ...ashby, suffix: '' })).toBe(
      `site:jobs.ashbyhq.com ${titles} nestjs`,
    );
  });

  it('runs once over every member in the window and attributes hits', async () => {
    const queries = [
      {
        id: 'qs-1',
        keyword: `${titles} nestjs "remote"`,
        params: { remote: true },
      },
      {
        id: 'qs-2',
        keyword: `${titles} go "remote"`,
        params: { remote: true },
      },
      {
        id: 'qs-3',
        keyword: `${titles} java "remote"`,
        params: { remote: true },
      },
    ];
    const lines = queries.map((q) => boardQuery(q.keyword, ashby));
    const { run, provider } = actor(() => [
      {
        searchQuery: { term: lines[0] },
        organicResults: [{ url: 'https://jobs.ashbyhq.com/acme/1' }, {}],
      },
      {
        searchQuery: { term: lines[2] },
        organicResults: [{ url: 'https://jobs.ashbyhq.com/acme/3' }],
      },
    ]);
    const result = await new GoogleJobsSearchProvider(provider).search(
      segment(Channel.ASHBY, queries),
      ashby,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual({
      queries: lines.join('\n'),
      maxPagesPerQuery: 3,
      quickDateRange: 'h2',
    });
    expect(result.hitsByQuery.get('qs-1')?.map((h) => h.url)).toEqual([
      'https://jobs.ashbyhq.com/acme/1',
    ]);
    expect(result.hitsByQuery.get('qs-2')).toEqual([]);
    expect(result.hitsByQuery.get('qs-3')?.map((h) => h.url)).toEqual([
      'https://jobs.ashbyhq.com/acme/3',
    ]);
    expect(result.fetched).toBe(2);
    expect(result.truncatedQueryIds).toEqual([]);
    expect(result.unattributed).toEqual([]);
    expect(result.source).toEqual({ actor: ashby.actor, apifyRunId: 'run-1' });
  });

  it('keeps hits whose query matches no member as unattributed', async () => {
    const queries = [{ id: 'qs-1', keyword: `${titles} nestjs`, params: {} }];
    const { provider } = actor(() => [
      {
        searchQuery: { term: 'another query' },
        organicResults: [
          { url: 'https://jobs.ashbyhq.com/acme/9', position: 4 },
        ],
      },
    ]);
    const result = await new GoogleJobsSearchProvider(provider).search(
      segment(Channel.ASHBY, queries),
      ashby,
    );
    expect(result.hitsByQuery.get('qs-1')).toEqual([]);
    expect(result.unattributed.map((h) => [h.url, h.rank])).toEqual([
      ['https://jobs.ashbyhq.com/acme/9', 4],
    ]);
  });

  it('never sets a Google country and searches whole days', async () => {
    // A countryCode left on an older builder's params must not leak through.
    const onsite = (id: string) => ({
      id,
      keyword: `${titles} nestjs "casablanca, morocco"`,
      params: { remote: false, countryCode: 'ma' },
    });
    const shared = actor(() => []);
    await new GoogleJobsSearchProvider(shared.provider).search(
      {
        channel: Channel.ASHBY,
        since: new Date('2026-10-28T12:00:00Z'),
        until,
        queries: [onsite('qs-1'), onsite('qs-2')],
      },
      ashby,
    );
    expect(shared.run.mock.calls[0][1]).toMatchObject({ quickDateRange: 'd3' });
    expect(shared.run.mock.calls[0][1]).not.toHaveProperty('countryCode');
  });

  it('marks a query truncated when its last allowed page has more', async () => {
    const queries = [
      { id: 'qs-1', keyword: `${titles} nestjs`, params: {} },
      { id: 'qs-2', keyword: `${titles} go`, params: {} },
    ];
    const [a, b] = queries.map((q) => boardQuery(q.keyword, ashby));
    const page = (term: string, hasNextPage: boolean) => ({
      searchQuery: { term },
      hasNextPage,
      organicResults: [{ url: `https://jobs.ashbyhq.com/acme/${term.length}` }],
    });
    const { provider } = actor(() => [
      page(a, true),
      page(a, true),
      page(a, true),
      page(b, true),
      page(b, false),
    ]);
    const result = await new GoogleJobsSearchProvider(provider).search(
      segment(Channel.ASHBY, queries),
      ashby,
    );
    expect(result.truncatedQueryIds).toEqual(['qs-1']);
  });

  it('keeps postings it cannot fetch, with the fetch error, instead of failing the segment', async () => {
    const queries = [{ id: 'qs-1', keyword: `${titles} nestjs`, params: {} }];
    const line = boardQuery(queries[0].keyword, AshbyCollector.config);
    const { provider } = actor(() => [
      {
        searchQuery: { term: line },
        organicResults: [
          { url: 'https://jobs.ashbyhq.com/acme/1', position: 1 },
          { url: 'https://jobs.ashbyhq.com/acme/closed', position: 2 },
        ],
      },
    ]);
    const postings = {
      fetch: vi.fn(async (url: string) => {
        if (url.endsWith('closed')) throw new Error('closed');
        return { id: 'p1', title: 'Engineer', descriptionHtml: '<p>x</p>' };
      }),
    } as unknown as AshbyPostingProvider;
    const result = await new AshbyCollector(
      new GoogleJobsSearchProvider(provider),
      postings,
    ).collect(segment(Channel.ASHBY, queries));
    expect(result.itemsByQuery.get('qs-1')).toEqual([
      {
        rank: 1,
        payload: {
          hit: { url: 'https://jobs.ashbyhq.com/acme/1', position: 1 },
          resolvedUrl: null,
          posting: { id: 'p1', title: 'Engineer', descriptionHtml: '<p>x</p>' },
          fetchError: null,
        },
      },
      {
        rank: 2,
        payload: {
          hit: { url: 'https://jobs.ashbyhq.com/acme/closed', position: 2 },
          resolvedUrl: null,
          posting: null,
          fetchError: 'closed',
        },
      },
    ]);
    expect(result.source).toEqual({
      actor: AshbyCollector.config.actor,
      apifyRunId: 'run-1',
    });
  });

  it('follows Google redirect links to the posting, keeping the hit untouched', async () => {
    const queries = [{ id: 'qs-1', keyword: `${titles} nestjs`, params: {} }];
    const line = boardQuery(queries[0].keyword, AshbyCollector.config);
    const goto = 'https://www.google.com/goto?url=CAES123';
    const lost = 'https://www.google.com/goto?url=CAESlost';
    const real =
      'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000001';
    const { provider } = actor(() => [
      {
        searchQuery: { term: line },
        organicResults: [
          { url: goto, position: 1 },
          { url: lost, position: 2 },
        ],
      },
    ]);
    const http = vi.fn(async (url: string) =>
      url === goto
        ? new Response(null, { status: 302, headers: { location: real } })
        : new Response('gone', { status: 404 }),
    );
    vi.stubGlobal('fetch', http);
    const postings = {
      fetch: vi.fn(async (url: string) => ({ id: url.split('/').at(-1) })),
    } as unknown as AshbyPostingProvider;
    try {
      const result = await new AshbyCollector(
        new GoogleJobsSearchProvider(provider),
        postings,
      ).collect(segment(Channel.ASHBY, queries));

      expect(http).toHaveBeenCalledWith(
        goto,
        expect.objectContaining({ redirect: 'manual' }),
      );
      expect(postings.fetch).toHaveBeenCalledWith(real);
      expect(result.itemsByQuery.get('qs-1')).toEqual([
        {
          rank: 1,
          payload: {
            hit: { url: goto, position: 1 },
            resolvedUrl: real,
            posting: { id: '0b1c2d3e-0000-4000-8000-000000000001' },
            fetchError: null,
          },
        },
        {
          rank: 2,
          payload: {
            hit: { url: lost, position: 2 },
            resolvedUrl: null,
            posting: null,
            fetchError: 'Google redirect not resolved: HTTP 404',
          },
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
