import { Channel } from 'src/common/enums';
import ashbyFailed from '../utils/fixtures/ashby-failed.json';
import ashby from '../utils/fixtures/ashby.json';
import greenhouse from '../utils/fixtures/greenhouse.json';
import { normalize as normalizeRaw, type NormalizedRecord } from '.';
import { decodeEntitiesOnce, htmlToPlainText } from './text';

const scrapedAt = new Date('2026-11-10T20:32:26.671Z');
const normalize = (channel: Channel, payload: unknown) =>
  normalizeRaw(channel, payload, { scrapedAt });

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

  it('has no posted time when publishedDate is a date only, an exact one otherwise', () => {
    expect(record(ashbyWith({})).postedAt).toBeNull();
    expect(
      record(ashbyWith({ publishedDate: '2026-10-30T08:15:00.000Z' })).postedAt,
    ).toBe('2026-10-30T08:15:00.000Z');
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
      postedAt: null,
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
      workplaceType: null,
      remoteAllowed: null,
      employmentType: null,
      countryCode: null,
      regionCode: null,
      city: null,
      state: null,
      geoId: null,
      applicantTrackingSystem: null,
      applicantCount: null,
      expiresAt: null,
      listingState: null,
      company: null,
      post: null,
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
  it('converts first_published to an exact UTC posted time', () => {
    const r = record(
      normalize(Channel.GREEN_HOUSE, { ...greenhouse, posting: ghPosting }),
    );
    expect(r.postedAt).toBe('2026-10-30T03:30:00.000Z');
  });

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

  it('leaves an entity for an unpaired surrogate undecoded', () => {
    expect(decodeEntitiesOnce('a&#xD800;b&#57343;c')).toBe(
      'a&#xD800;b&#57343;c',
    );
  });

  it('decodes a double-encoded entity exactly once', () => {
    expect(decodeEntitiesOnce('&amp;lt;p&amp;gt;')).toBe('&lt;p&gt;');
  });
});

describe('ATS records carry no LinkedIn-only fields', () => {
  it('leaves them null', () => {
    const nulls = {
      workplaceType: null,
      remoteAllowed: null,
      employmentType: null,
      countryCode: null,
      regionCode: null,
      applicantTrackingSystem: null,
      applicantCount: null,
      expiresAt: null,
      listingState: null,
      company: null,
    };
    expect(record(ashbyWith({}))).toMatchObject(nulls);
    expect(
      record(
        normalize(Channel.GREEN_HOUSE, { ...greenhouse, posting: ghPosting }),
      ),
    ).toMatchObject(nulls);
  });
});
