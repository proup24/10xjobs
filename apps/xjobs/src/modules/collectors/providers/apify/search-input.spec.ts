import { Channel } from 'src/common/enums';
import { channelConfig } from '../../config';
import type { CollectorSearch } from '../../types/collector';
import type { ApifyActorProvider } from './apify.provider';
import { GoogleJobsSearchProvider } from './google_search.collector';
import {
  LinkedinJobSearchProvider,
  linkedinJobSearchUrl,
} from './linkedin.job_search.collector';
import { LinkedinPostSearchProvider } from './linkedin.post_search.collector';

function actor() {
  const run = vi.fn(
    async (_actor: string, _input: Record<string, unknown>) => [] as unknown[],
  );
  return { run, provider: { run } as unknown as ApifyActorProvider };
}

const search = (
  channel: Channel,
  keyword: string,
  params: Record<string, unknown> = {},
): CollectorSearch => ({ id: 'qs-1', channel, keyword, params });

describe('linkedinJobSearchUrl', () => {
  it('searches the keyword with the location, experience and work type filters', () => {
    const url = new URL(
      linkedinJobSearchUrl('senior backend engineer nestjs', {
        location: 'EMEA',
        experienceLevel: '4',
        workType: '2',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/jobs/search/',
    );
    expect(url.searchParams.get('keywords')).toBe(
      'senior backend engineer nestjs',
    );
    expect(url.searchParams.get('location')).toBe('EMEA');
    expect(url.searchParams.get('f_E')).toBe('4');
    expect(url.searchParams.get('f_WT')).toBe('2');
  });

  it('sends GLOBAL as Worldwide and omits missing filters', () => {
    const url = new URL(linkedinJobSearchUrl('x', { location: 'GLOBAL' }));
    expect(url.searchParams.get('location')).toBe('Worldwide');
    expect(url.searchParams.has('f_E')).toBe(false);
    expect(url.searchParams.has('f_WT')).toBe(false);
    expect(url.href).not.toContain('undefined');
  });
});

describe('search input comes only from the builder', () => {
  it('runs the LinkedIn job board once for the builder URL', async () => {
    const { run, provider } = actor();
    const params = { location: 'EMEA', experienceLevel: '4', workType: '2' };
    await new LinkedinJobSearchProvider(provider).search(
      search(Channel.LINKEDIN_JOB_BOARD, 'senior backend engineer', params),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({
      startUrls: [
        { url: linkedinJobSearchUrl('senior backend engineer', params) },
      ],
    });
  });

  it('runs LinkedIn posts once for the builder keyword', async () => {
    const { run, provider } = actor();
    await new LinkedinPostSearchProvider(provider).search(
      search(
        Channel.LINKEDIN_POSTS,
        'hiring senior backend engineer nestjs remote',
        { location: 'EMEA' },
      ),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({
      searchQueries: ['hiring senior backend engineer nestjs remote'],
    });
  });

  it.each([
    [Channel.ASHBY, 'jobs.ashbyhq.com'],
    [Channel.GREEN_HOUSE, 'greenhouse.io'],
  ] as const)(
    'searches %s boards on Google with one query',
    async (channel, site) => {
      const { run, provider } = actor();
      await new GoogleJobsSearchProvider(provider).search(
        channel,
        'backend engineer',
      );
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1]).toMatchObject({
        queries: `site:${site} "backend engineer" ${channelConfig[channel].discovery.suffix}`,
      });
    },
  );
});
