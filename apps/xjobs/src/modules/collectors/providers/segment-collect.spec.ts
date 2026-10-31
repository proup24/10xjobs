import { Channel } from 'src/common/enums';
import type {
  BoardSearchRunConfig,
  LinkedinJobBoardRunConfig,
  LinkedinPostsRunConfig,
  SegmentSearch,
} from '../types/collector';
import type { ApifyActorProvider } from './apify/apify.provider';
import {
  GoogleJobsSearchProvider,
  boardQuery,
} from './apify/google_search.collector';
import {
  LinkedinJobSearchProvider,
  linkedinJobSearchUrl,
} from './apify/linkedin.job_search.collector';
import { LinkedinPostSearchProvider } from './apify/linkedin.post_search.collector';
import { AshbyCollector } from './ashby.service';
import type { AshbyPostingProvider } from './extraction/ashby.provider';

const until = new Date('2026-10-31T12:00:00Z');
const since = new Date('2026-10-31T10:00:00Z');

function actor(
  items: (input: Record<string, unknown>) => unknown[],
  costUsd: number | null = 0.2,
) {
  const run = vi.fn(async (_actor: string, input: Record<string, unknown>) => ({
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

const board: LinkedinJobBoardRunConfig = {
  actor: 'bebity/linkedin-jobs-scraper',
  maxRunChargeUsd: 1,
  maxRowsPerUrl: 2,
};
const posts: LinkedinPostsRunConfig = {
  actor: 'harvestapi/linkedin-post-search',
  maxRunChargeUsd: 1,
  maxPostsPerQuery: 2,
};
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

describe('LinkedIn job board segment', () => {
  const queries = [
    { id: 'qs-1', keyword: 'backend nestjs', params: { location: 'Germany' } },
    { id: 'qs-2', keyword: 'backend go', params: { location: 'Germany' } },
    { id: 'qs-3', keyword: 'backend java', params: { location: 'Germany' } },
  ];
  const urlOf = (i: number) =>
    linkedinJobSearchUrl(queries[i].keyword, queries[i].params, 7200);
  const item = (id: number, inputUrl: string, index: number) => ({
    id,
    link: `https://www.linkedin.com/jobs/view/${id}`,
    title: 'Engineer',
    companyName: 'Acme',
    publishedAt: '2026-10-31',
    description: '<p>Build &amp; ship</p>',
    scrapingInfo: { inputUrl, index },
  });

  it('runs once over every member and attributes each job to its query', async () => {
    const { run, provider } = actor(() => [
      item(1, urlOf(0), 1),
      item(2, urlOf(0), 2),
      item(3, urlOf(2), 1),
      item(4, 'https://www.linkedin.com/jobs/search/?redirected', 1),
    ]);
    const result = await new LinkedinJobSearchProvider(provider).search(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
      board,
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(board.actor);
    expect(run.mock.calls[0][1]).toMatchObject({
      startUrls: [0, 1, 2].map((i) => ({ url: urlOf(i) })),
      maxRowsPerUrl: 2,
    });
    expect(result.itemsByQuery.get('qs-1')).toEqual([
      { rank: 1, payload: item(1, urlOf(0), 1) },
      { rank: 2, payload: item(2, urlOf(0), 2) },
    ]);
    expect(result.itemsByQuery.get('qs-2')).toEqual([]);
    expect(result.itemsByQuery.get('qs-3')).toEqual([
      { rank: 1, payload: item(3, urlOf(2), 1) },
    ]);
    // The redirected item matches no member, and is kept, untouched.
    expect(result.unattributed).toEqual([
      {
        rank: 1,
        payload: item(4, 'https://www.linkedin.com/jobs/search/?redirected', 1),
      },
    ]);
    expect(result.fetched).toBe(4);
    expect(result.truncatedQueryIds).toEqual(['qs-1']);
    expect(result.source).toEqual({ actor: board.actor, apifyRunId: 'run-1' });
  });

  it('matches echoed URLs whatever their encoding and parameter order', async () => {
    const url = new URL(urlOf(0));
    const echoed =
      `${url.origin}${url.pathname}?` +
      [...url.searchParams]
        .reverse()
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
    expect(echoed).not.toBe(urlOf(0));
    const { provider } = actor(() => [item(1, echoed, 1)]);
    const result = await new LinkedinJobSearchProvider(provider).search(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
      board,
    );
    expect(
      result.itemsByQuery.get('qs-1')?.map((i) => (i.payload as { id: number }).id),
    ).toEqual([1]);
  });

  it('has no rank when the actor reports no position', async () => {
    const { provider } = actor(() => [
      { ...item(1, urlOf(0), 0), scrapingInfo: { inputUrl: urlOf(0) } },
    ]);
    const result = await new LinkedinJobSearchProvider(provider).search(
      segment(Channel.LINKEDIN_JOB_BOARD, queries),
      board,
    );
    expect(result.itemsByQuery.get('qs-1')?.[0]?.rank).toBeNull();
  });

  it('reports the cost and whether the charge cap was reached', async () => {
    const capped = await new LinkedinJobSearchProvider(
      actor(() => [], 0.96).provider,
    ).search(segment(Channel.LINKEDIN_JOB_BOARD, queries), board);
    expect(capped).toMatchObject({ costUsd: 0.96, capped: true });

    const unknown = await new LinkedinJobSearchProvider(
      actor(() => [], null).provider,
    ).search(segment(Channel.LINKEDIN_JOB_BOARD, queries), board);
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
    const { run, provider } = actor(() => [
      post('7', queries[1].keyword),
      post('8', queries[1].keyword),
      post('9', 'unknown query'),
    ]);
    const result = await new LinkedinPostSearchProvider(provider).search(
      segment(Channel.LINKEDIN_POSTS, queries),
      posts,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({
      searchQueries: queries.map((q) => q.keyword),
      maxPosts: 2,
      postedLimitDate: since.toISOString(),
      sortBy: 'date',
    });
    expect(result.itemsByQuery.get('qs-2')).toEqual([
      { rank: null, payload: post('7', queries[1].keyword) },
      { rank: null, payload: post('8', queries[1].keyword) },
    ]);
    expect(result.itemsByQuery.get('qs-1')).toEqual([]);
    expect(result.unattributed).toEqual([
      { rank: null, payload: post('9', 'unknown query') },
    ]);
    expect(result.truncatedQueryIds).toEqual(['qs-2']);
    expect(result.fetched).toBe(3);
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
        organicResults: [{ url: 'https://jobs.ashbyhq.com/acme/9', position: 4 }],
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

  it('localises an onsite segment to its country and searches whole days', async () => {
    const onsite = (id: string, countryCode: string) => ({
      id,
      keyword: `${titles} nestjs "casablanca"`,
      params: { remote: false, countryCode },
    });
    const long = {
      channel: Channel.ASHBY,
      since: new Date('2026-10-28T12:00:00Z'),
      until,
    };
    const shared = actor(() => []);
    await new GoogleJobsSearchProvider(shared.provider).search(
      { ...long, queries: [onsite('qs-1', 'ma'), onsite('qs-2', 'ma')] },
      ashby,
    );
    expect(shared.run.mock.calls[0][1]).toMatchObject({
      countryCode: 'ma',
      quickDateRange: 'd3',
    });

    const mixed = actor(() => []);
    await new GoogleJobsSearchProvider(mixed.provider).search(
      { ...long, queries: [onsite('qs-1', 'ma'), onsite('qs-2', 'fr')] },
      ashby,
    );
    expect(mixed.run.mock.calls[0][1]).not.toHaveProperty('countryCode');
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
    const line = boardQuery(queries[0].keyword, ashby);
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
    ).collect(segment(Channel.ASHBY, queries), ashby);
    expect(result.itemsByQuery.get('qs-1')).toEqual([
      {
        rank: 1,
        payload: {
          hit: { url: 'https://jobs.ashbyhq.com/acme/1', position: 1 },
          posting: { id: 'p1', title: 'Engineer', descriptionHtml: '<p>x</p>' },
          fetchError: null,
        },
      },
      {
        rank: 2,
        payload: {
          hit: { url: 'https://jobs.ashbyhq.com/acme/closed', position: 2 },
          posting: null,
          fetchError: 'closed',
        },
      },
    ]);
    expect(result.source).toEqual({ actor: ashby.actor, apifyRunId: 'run-1' });
  });
});
