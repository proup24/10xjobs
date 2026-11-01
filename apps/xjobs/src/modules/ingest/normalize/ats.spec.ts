import { Channel } from 'src/common/enums';
import ashbyFailed from '../utils/fixtures/ashby-failed.json';
import ashby from '../utils/fixtures/ashby.json';
import greenhouse from '../utils/fixtures/greenhouse.json';
import { normalize, type NormalizedRecord } from '.';
import { decodeEntitiesOnce, htmlToPlainText } from './text';

function record(result: ReturnType<typeof normalize>): NormalizedRecord {
  if ('invalid' in result) throw new Error(result.invalid);
  return result.record;
}

const ashbyWith = (posting: Record<string, unknown>) =>
  normalize(Channel.ASHBY, {
    ...ashby,
    posting: { ...ashby.posting, ...posting },
  });
const ghPosting = {
  ...greenhouse.posting,
  company_name: 'Acme Inc',
  location: { name: 'Berlin, Germany' },
  first_published: '2026-10-29T23:30:00-04:00',
  absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/42',
};
const closedMessage = (provider: string) =>
  `${provider} posting is closed or unavailable`;

describe('normalize Ashby', () => {
  it('maps the posting fields', () => {
    const r = record(ashbyWith({ employmentType: 'FullTime' }));
    expect(r).toMatchObject({
      kind: 'job',
      title: 'Senior Backend Engineer',
      location: 'Remote',
      contractType: 'Full-time',
      publishedAt: '2026-10-30',
      descriptionHtml: '<p>Build APIs.</p>',
      descriptionText: htmlToPlainText('<p>Build APIs.</p>'),
      postingUrl: ashby.hit.url,
      applyUrl: ashby.hit.url,
      closed: false,
    });
  });

  it('never guesses the company from the Google title or the slug', () => {
    expect(ashby.hit.title).toContain('@ Acme');
    expect(record(ashbyWith({})).companyName).toBeNull();
  });

  it('leaves an unknown employment type null', () => {
    expect(record(ashbyWith({ employmentType: 'Other' })).contractType).toBe(
      null,
    );
  });

  it('uses the URL a Google redirect resolved to', () => {
    const resolvedUrl =
      'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000002';
    const r = record(
      normalize(Channel.ASHBY, {
        ...ashby,
        hit: { ...ashby.hit, url: 'https://www.google.com/url?q=x' },
        resolvedUrl,
      }),
    );
    expect(r.postingUrl).toBe(resolvedUrl);
  });

  it('records a closed posting as closed, with no content', () => {
    const r = record(
      normalize(Channel.ASHBY, {
        ...ashbyFailed,
        fetchError: closedMessage('Ashby'),
      }),
    );
    expect(r).toEqual({
      kind: 'job',
      title: null,
      companyName: null,
      companyUrl: null,
      location: null,
      contractType: null,
      experienceLevel: null,
      sector: null,
      salary: null,
      publishedAt: null,
      descriptionHtml: null,
      descriptionText: null,
      applyUrl: null,
      postingUrl: ashbyFailed.hit.url,
      poster: null,
      closed: true,
    });
  });

  it('is invalid when the fetch failed for another reason', () => {
    expect(normalize(Channel.ASHBY, ashbyFailed)).toEqual({
      invalid: 'normalize: posting not fetched',
    });
  });
});

describe('normalize Greenhouse', () => {
  it('maps the posting fields', () => {
    const r = record(
      normalize(Channel.GREEN_HOUSE, { ...greenhouse, posting: ghPosting }),
    );
    expect(r).toMatchObject({
      kind: 'job',
      title: 'Platform Engineer',
      companyName: 'Acme Inc',
      location: 'Berlin, Germany',
      publishedAt: '2026-10-30',
      descriptionHtml: '<p>Run k8s.</p>',
      descriptionText: 'Run k8s.',
      postingUrl: ghPosting.absolute_url,
      applyUrl: ghPosting.absolute_url,
      closed: false,
    });
  });

  it('falls back to the hit URL without an absolute URL', () => {
    const r = record(normalize(Channel.GREEN_HOUSE, greenhouse));
    expect(r.postingUrl).toBe(greenhouse.hit.url);
  });

  it('records a closed posting as closed', () => {
    const r = record(
      normalize(Channel.GREEN_HOUSE, {
        hit: greenhouse.hit,
        posting: null,
        fetchError: closedMessage('Greenhouse'),
      }),
    );
    expect(r.closed).toBe(true);
    expect(r.postingUrl).toBe(greenhouse.hit.url);
  });
});

describe('decodeEntitiesOnce', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntitiesOnce('&lt;p&gt;x&#39;s &#x26; y&lt;/p&gt;')).toBe(
      "<p>x's & y</p>",
    );
  });

  it('decodes a double-encoded entity exactly once', () => {
    expect(decodeEntitiesOnce('&amp;lt;p&amp;gt;')).toBe('&lt;p&gt;');
  });
});
