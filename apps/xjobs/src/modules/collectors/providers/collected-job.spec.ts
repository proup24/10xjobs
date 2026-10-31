import { Channel } from 'src/common/enums';
import { normalizeItem } from '../../ingest/utils';
import type { ApifyActorProvider } from './apify/apify.provider';
import { GoogleJobsSearchProvider } from './apify/google_search.provider';
import { LinkedinJobSearchProvider } from './apify/linkedin.job_search.provider';
import { LinkedinPostSearchProvider } from './apify/linkedin.post_search.provider';

const search = {
  id: 'search-1',
  workspaceId: 'workspace-1',
  channel: Channel.LINKEDIN_POSTS,
  keywords: [] as string[],
  params: {},
};

function actor(results: (input: Record<string, unknown>) => unknown[]) {
  const run = vi.fn(async (_actor: string, input: Record<string, unknown>) =>
    results(input),
  );
  return { run, provider: { run } as unknown as ApifyActorProvider };
}

describe('collected job mapping', () => {
  beforeEach(() => vi.stubEnv('APIFY_TOKEN', 'token'));
  afterEach(() => vi.unstubAllEnvs());

  it('maps LinkedIn jobs to the contract with the query that found them', async () => {
    const { run, provider } = actor((input) => {
      const [{ url }] = input.startUrls as { url: string }[];
      return url.includes('keywords=typescript&location=Germany')
        ? [
            {
              id: 42,
              link: 'https://www.linkedin.com/jobs/view/42',
              applyUrl: 'https://jobs.ashbyhq.com/acme/apply',
              title: 'Engineer',
              companyName: 'Acme',
              location: 'Berlin',
              publishedAt: '2026-10-30',
              description: '<p>Build &amp; ship</p>',
              posterFullName: 'Jane',
              posterProfileUrl: 'https://www.linkedin.com/in/jane',
            },
          ]
        : [];
    });
    const jobs = await new LinkedinJobSearchProvider(provider).search(search);
    expect(run).toHaveBeenCalledTimes(24);
    expect(jobs).toEqual([
      {
        source: 'linkedin-jobs',
        sourceJobId: '42',
        url: 'https://www.linkedin.com/jobs/view/42',
        applyUrl: 'https://jobs.ashbyhq.com/acme/apply',
        title: 'Engineer',
        company: 'Acme',
        location: 'Berlin',
        postedAt: '2026-10-30',
        postedAtPrecision: 'day',
        description: 'Build & ship',
        contact: { name: 'Jane', url: 'https://www.linkedin.com/in/jane' },
        search: 'typescript in Germany',
        raw: expect.objectContaining({ id: 42 }),
      },
    ]);
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, jobs[0]),
    ).not.toThrow();
  });

  it('maps LinkedIn posts without turning the author into the employer', async () => {
    const { provider } = actor((input) =>
      (input.searchQueries as string[])[0] === 'hiring typescript remote'
        ? [
            {
              id: '7',
              linkedinUrl:
                'https://www.linkedin.com/feed/update/urn:li:activity:7/',
              content: '\nWe are hiring\nTypeScript engineers',
              author: {
                name: 'Jane',
                type: 'profile',
                linkedinUrl: 'https://www.linkedin.com/in/jane',
              },
              postedAt: { date: '2026-10-30T12:00:00Z' },
            },
          ]
        : [],
    );
    const [job] = await new LinkedinPostSearchProvider(provider).search(search);
    expect(job).toMatchObject({
      source: 'linkedin-posts',
      title: 'We are hiring',
      company: '',
      postedAtPrecision: 'hour',
      contact: { name: 'Jane', url: 'https://www.linkedin.com/in/jane' },
      search: 'hiring typescript remote',
    });
    expect(normalizeItem(Channel.LINKEDIN_POSTS, job)).toMatchObject({
      company: null,
      authorName: 'Jane',
    });
  });

  it('flattens Google result pages and keeps each result query', async () => {
    const { provider } = actor(() => [
      {
        searchQuery: { term: 'site:jobs.ashbyhq.com "node" remote' },
        organicResults: [{ url: 'https://jobs.ashbyhq.com/acme/1' }, {}],
      },
    ]);
    const hits = await new GoogleJobsSearchProvider(provider).search(
      Channel.ASHBY,
      ['node'],
    );
    expect(hits).toEqual([
      {
        url: 'https://jobs.ashbyhq.com/acme/1',
        search: 'site:jobs.ashbyhq.com "node" remote',
        raw: { url: 'https://jobs.ashbyhq.com/acme/1' },
      },
    ]);
  });
});
