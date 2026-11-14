import { Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { SearchNotStartedError } from '../utils/search-not-started';
import type { BoardSearchRunConfig, SegmentSearch } from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import { GoogleJobsSearchProvider } from './apify/google-search.provider';
import { LinkedinJobBoardCollector } from './linkedin-job-board.collector';
import { boardQuery } from './mappers/google-search.mapper';
import {
  mergedLinkedinKeyword,
  toHarvestJobSearchInput,
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

describe('LinkedIn job board segment', () => {
  const queries = [
    {
      id: 'qs-1',
      keyword: 'backend nestjs',
      params: {
        location: 'Germany',
        roleWords: ['backend'],
        spellings: ['nestjs'],
      },
    },
    {
      id: 'qs-2',
      keyword: 'backend nestjs',
      params: {
        location: 'Germany',
        roleWords: ['backend'],
        spellings: ['nestjs'],
      },
    },
  ];
  const item = (id: number, totalElements = 40) => ({
    id: String(id),
    title: 'Engineer',
    linkedinUrl: `https://www.linkedin.com/jobs/view/${id}/`,
    descriptionText: 'Build & ship',
    applyMethod: {},
    jobState: 'LISTED',
    _meta: { pagination: { totalElements } },
  });
  const board_ = (provider: ApifyActorProvider) =>
    new LinkedinJobBoardCollector(provider);

  it('runs its one search and gives every member every item, in dataset order', async () => {
    const { run, provider } = actor(() => [item(1), item(2)]);
    const result = await board_(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe('harvestapi/linkedin-job-search');
    expect(run.mock.calls[0][1]).toEqual(
      toHarvestJobSearchInput(
        mergedLinkedinKeyword(queries),
        queries[0].params,
        100,
      ),
    );
    expect(run.mock.calls[0][2]).toEqual({ maxChargeUsd: 0.25 });
    const expected = [
      { rank: 1, payload: item(1) },
      { rank: 2, payload: item(2) },
    ];
    expect(result.itemsByQuery.get('qs-1')).toEqual(expected);
    expect(result.itemsByQuery.get('qs-2')).toEqual(expected);
    expect(result.unattributed).toEqual([]);
    expect(result.fetched).toBe(2);
    expect(result.source).toEqual({
      actor: 'harvestapi/linkedin-job-search',
      apifyRunId: 'run-1',
    });
  });

  it("sends the same input whatever the segment's window", async () => {
    const inputs: unknown[] = [];
    for (const hours of [1, 24]) {
      const { run, provider } = actor(() => []);
      await board_(provider).collect({
        ...segment(Channel.LINKEDIN_JOB_BOARD, queries),
        since: new Date(until.getTime() - hours * 3_600_000),
      });
      inputs.push(run.mock.calls[0][1]);
    }
    expect(inputs[0]).toEqual(inputs[1]);
  });

  it('runs members that spell a geoId-pinned place differently as one search', async () => {
    const pinned = [
      {
        id: 'qs-a',
        keyword: 'go',
        params: {
          location: 'uae',
          geoId: '104305776',
          roleWords: ['backend'],
          spellings: ['go'],
        },
      },
      {
        id: 'qs-b',
        keyword: 'go',
        params: {
          location: 'united arab emirates',
          geoId: '104305776',
          roleWords: ['backend'],
          spellings: ['go'],
        },
      },
    ];
    const { run, provider } = actor(() => [item(1, 1)]);
    const result = await board_(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, pinned),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.itemsByQuery.get('qs-a')).toHaveLength(1);
    expect(result.itemsByQuery.get('qs-b')).toHaveLength(1);
  });

  it('throws, naming the location, when a place has no geoId', async () => {
    const { run, provider } = actor(() => [item(1)]);
    await expect(
      board_(provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, [
          { id: 'qs-a', keyword: 'go', params: { location: 'Atlantis' } },
        ]),
      ),
    ).rejects.toThrow(/Atlantis/);
    expect(run).not.toHaveBeenCalled();
  });

  it('says no Apify run started when a place has no geoId or members differ', async () => {
    const { run, provider } = actor(() => [item(1)]);
    const unresolved = board_(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, [
        { id: 'qs-a', keyword: 'go', params: { location: 'Atlantis' } },
      ]),
    );
    await expect(unresolved).rejects.toBeInstanceOf(SearchNotStartedError);
    const mixed = board_(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, [
        { id: 'qs-a', keyword: 'go', params: { location: 'Germany' } },
        {
          id: 'qs-b',
          keyword: 'go',
          params: { location: 'Germany', workType: '2' },
        },
      ]),
    );
    await expect(mixed).rejects.toBeInstanceOf(SearchNotStartedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('says the actor failed as a plain error, not as a search that never started', async () => {
    const run = vi.fn(async () => {
      throw new Error('apify down');
    });
    const failing = board_({ run } as unknown as ApifyActorProvider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    await expect(failing).rejects.toThrow('apify down');
    await expect(failing).rejects.not.toBeInstanceOf(SearchNotStartedError);
  });

  it('refuses a segment whose members run different searches', async () => {
    const { run, provider } = actor(() => [item(1)]);
    await expect(
      board_(provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, [
          { id: 'qs-a', keyword: 'go', params: { location: 'Germany' } },
          {
            id: 'qs-b',
            keyword: 'rust',
            params: { location: 'Germany', workType: '2' },
          },
        ]),
      ),
    ).rejects.toThrow(/one search/);
    expect(run).not.toHaveBeenCalled();
  });

  it("sends one jobTitles entry: the members' merged keyword", async () => {
    const members = [
      {
        id: 'qs-1',
        keyword: 'ignored',
        params: {
          location: 'Germany',
          roleWords: ['backend'],
          spellings: ['go', 'golang'],
        },
      },
      {
        id: 'qs-2',
        keyword: 'ignored',
        params: {
          location: 'Germany',
          roleWords: ['developer'],
          spellings: ['go', 'rust'],
        },
      },
    ];
    const { run, provider } = actor(() => []);
    await board_(provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, members),
    );
    const input = run.mock.calls[0][1] as { jobTitles: string[] };
    expect(input.jobTitles).toEqual([mergedLinkedinKeyword(members)]);
  });

  it('refuses members with different experience levels', async () => {
    const { run, provider } = actor(() => []);
    await expect(
      board_(provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, [
          {
            id: 'qs-a',
            keyword: 'go',
            params: { location: 'Germany', experienceLevel: '4' },
          },
          {
            id: 'qs-b',
            keyword: 'go',
            params: { location: 'Germany', experienceLevel: '5' },
          },
        ]),
      ),
    ).rejects.toThrow(/one search/);
    expect(run).not.toHaveBeenCalled();
  });

  it('scales maxItems and the charge cap with the segment row limit', async () => {
    expect(board.maxRowsCeiling).toBe(1000);
    const { run, provider } = actor(() => []);
    await board_(provider).collect({
      ...segment(Channel.LINKEDIN_JOB_BOARD, queries),
      maxItems: 1000,
    });
    expect(run.mock.calls[0][1]).toMatchObject({ maxItems: 1000 });
    expect(run.mock.calls[0][2]).toEqual({ maxChargeUsd: 2.5 });
  });

  it('counts the search as truncated at the row limit, or when LinkedIn reports more than came back', async () => {
    const full = Array.from({ length: board.maxRowsPerSearch }, (_, i) =>
      item(100 + i, board.maxRowsPerSearch),
    );
    const atLimit = await board_(actor(() => full).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(atLimit.truncatedQueryIds).toEqual(['qs-1', 'qs-2']);
    expect(atLimit.itemsByQuery.get('qs-1')?.at(-1)?.rank).toBe(100);

    const more = Array.from({ length: 30 }, (_, i) => item(i, 40));
    const partial = await board_(actor(() => more).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(partial.truncatedQueryIds).toEqual(['qs-1', 'qs-2']);

    const complete = Array.from({ length: 30 }, (_, i) => item(i, 30));
    const whole = await board_(actor(() => complete).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(whole.truncatedQueryIds).toEqual([]);
  });

  it('warns when a run returned fewer rows than its limit while LinkedIn reports more', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const more = Array.from({ length: 30 }, (_, i) => item(i, 40));
      await board_(actor(() => more).provider).collect({
        ...segment(Channel.LINKEDIN_JOB_BOARD, queries),
        segmentKey: 'seg-k',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        'LinkedIn search seg-k returned 30 of 100 rows but reports 40 in total',
      );

      warn.mockClear();
      // At the row limit, or with the total matched, nothing is said.
      const full = Array.from({ length: board.maxRowsPerSearch }, (_, i) =>
        item(i, 500),
      );
      await board_(actor(() => full).provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, queries),
      );
      const whole = Array.from({ length: 30 }, (_, i) => item(i, 30));
      await board_(actor(() => whole).provider).collect(
        segment(Channel.LINKEDIN_JOB_BOARD, queries),
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the first item's pagination as the search totals, null with no items", async () => {
    const withItems = await board_(
      actor(() => [item(1, 40), item(2, 99)]).provider,
    ).collect(segment(Channel.LINKEDIN_JOB_BOARD, queries));
    expect(withItems.searchTotals).toEqual({ totalElements: 40 });

    const none = await board_(actor(() => []).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(none.searchTotals).toBeNull();
  });

  it('reports the cost and whether the charge cap was reached', async () => {
    const atCap = board.maxRunChargeUsd * 0.96;
    const capped = await board_(actor(() => [], atCap).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
    expect(capped).toMatchObject({ costUsd: atCap, capped: true });

    const unknown = await board_(actor(() => [], null).provider).collect(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
    );
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
