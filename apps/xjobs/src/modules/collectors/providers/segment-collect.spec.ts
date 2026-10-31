import { Channel } from 'src/common/enums';
import { normalizeItem } from '../../ingest/utils';
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
    expect(result.jobsByQuery.get('qs-1')?.map((j) => j.sourceJobId)).toEqual([
      '1',
      '2',
    ]);
    expect(result.jobsByQuery.get('qs-2')).toEqual([]);
    expect(result.jobsByQuery.get('qs-3')?.map((j) => j.sourceJobId)).toEqual([
      '3',
    ]);
    expect(result.fetched).toBe(4);
    expect(result.truncatedQueryIds).toEqual(['qs-1']);
    expect(result.jobsByQuery.get('qs-1')?.[0]).toMatchObject({
      source: 'linkedin-jobs',
      search: 'backend nestjs in Germany',
      description: 'Build & ship',
    });
    expect(() =>
      normalizeItem(
        Channel.LINKEDIN_JOB_BOARD,
        result.jobsByQuery.get('qs-1')?.[0],
      ),
    ).not.toThrow();
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
    expect(result.jobsByQuery.get('qs-2')?.map((j) => j.sourceJobId)).toEqual([
      '7',
      '8',
    ]);
    expect(result.jobsByQuery.get('qs-1')).toEqual([]);
    expect(result.truncatedQueryIds).toEqual(['qs-2']);
    expect(result.fetched).toBe(3);
    expect(
      normalizeItem(
        Channel.LINKEDIN_POSTS,
        result.jobsByQuery.get('qs-2')?.[0],
      ),
    ).toMatchObject({ company: null, authorName: 'Jane' });
  });
});

describe('job board segments on Google', () => {
  it('builds one query per member, adding remote only for remote builders', () => {
    expect(boardQuery('backend engineer', { remote: true }, ashby)).toBe(
      'site:jobs.ashbyhq.com "backend engineer" intitle:engineer "remote"',
    );
    expect(boardQuery('backend engineer', { remote: false }, ashby)).toBe(
      'site:jobs.ashbyhq.com "backend engineer" intitle:engineer',
    );
  });

  it('runs once over every member in the window and attributes hits', async () => {
    const queries = [
      { id: 'qs-1', keyword: 'backend', params: { remote: true } },
      { id: 'qs-2', keyword: 'frontend', params: { remote: true } },
      { id: 'qs-3', keyword: 'devops', params: { remote: true } },
    ];
    const lines = queries.map((q) => boardQuery(q.keyword, q.params, ashby));
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
  });

  it('drops postings it cannot fetch instead of failing the segment', async () => {
    const queries = [{ id: 'qs-1', keyword: 'backend', params: {} }];
    const line = boardQuery('backend', {}, ashby);
    const { provider } = actor(() => [
      {
        searchQuery: { term: line },
        organicResults: [
          { url: 'https://jobs.ashbyhq.com/acme/1' },
          { url: 'https://jobs.ashbyhq.com/acme/closed' },
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
    expect(result.jobsByQuery.get('qs-1')?.map((j) => j.sourceJobId)).toEqual([
      'p1',
    ]);
  });
});
