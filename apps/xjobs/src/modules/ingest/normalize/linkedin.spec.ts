import { Channel } from 'src/common/enums';
import linkedinJob from '../utils/fixtures/linkedin-job.json';
import bebityCurrent from '../utils/fixtures/linkedin-job-bebity.json';
import cheapJob from '../utils/fixtures/linkedin-job-cheap.json';
import harvestJobs from '../utils/fixtures/linkedin-job-harvest.json';
import linkedinPost from '../utils/fixtures/linkedin-post.json';
import { normalize as normalizeRaw, type NormalizedRecord } from '.';

const job = (overrides: Record<string, unknown> = {}) =>
  normalize(Channel.LINKEDIN_JOB_BOARD, { ...linkedinJob, ...overrides });
const post = (overrides: Record<string, unknown> = {}) =>
  normalize(Channel.LINKEDIN_POSTS, { ...linkedinPost, ...overrides });

const scrapedAt = new Date('2026-11-10T20:32:26.671Z');
const normalize = (channel: Channel, payload: unknown) =>
  normalizeRaw(channel, payload, { scrapedAt });

function record(result: ReturnType<typeof normalize>): NormalizedRecord {
  if ('invalid' in result) throw new Error(result.invalid);
  return result.record;
}

describe('normalize LinkedIn job board', () => {
  it('maps every LinkedIn job field', () => {
    const r = record(job());
    expect(r).toMatchObject({
      kind: 'job',
      title: 'Senior Backend Engineer',
      companyName: 'Acme',
      location: 'Romania',
      contractType: 'Full-time',
      experienceLevel: 'Mid-Senior level',
      sector: 'IT Services and IT Consulting',
      publishedAt: '2026-10-31',
      descriptionText: 'Build APIs.',
      descriptionHtml: '<p>Build APIs.</p>',
      postingUrl: 'https://www.linkedin.com/jobs/view/4012345678',
      closed: false,
    });
  });

  it('canonicalizes a regional, slugged job URL to the job id', () => {
    const r = record(
      job({
        id: '4483941772',
        jobUrl:
          'https://pl.linkedin.com/jobs/view/senior-node-js-developer-at-sii-poland-4483941772',
      }),
    );
    expect(r.postingUrl).toBe('https://www.linkedin.com/jobs/view/4483941772');
  });

  it('maps salary when the actor states it', () => {
    const r = record(
      job({
        salary: '£50,000.00/yr - £80,000.00/yr',
        salaryMin: 50000,
        salaryMax: 80000,
        salaryCurrency: 'GBP',
        salaryPeriod: 'yr',
      }),
    );
    expect(r.salary).toEqual({
      text: '£50,000.00/yr - £80,000.00/yr',
      min: 50000,
      max: 80000,
      currency: 'GBP',
      period: 'yr',
      providedByEmployer: null,
    });
  });

  it('drops salary bounds too large to store, keeping the stated text', () => {
    const r = record(
      job({ salary: 'VND 3,000,000,000', salaryMin: 3e9, salaryMax: 4e9 }),
    );
    expect(r.salary).toMatchObject({
      text: 'VND 3,000,000,000',
      min: null,
      max: null,
    });
  });

  it('has no salary when the actor states none', () => {
    expect(record(job({ salary: '' })).salary).toBeNull();
  });

  it('has no poster when the poster fields are empty', () => {
    expect(
      record(job({ posterFullName: '', posterProfileUrl: '' })).poster,
    ).toBeNull();
  });

  it('maps the poster as a person', () => {
    expect(record(job()).poster).toEqual({
      name: 'Poster Name 1',
      profileUrl: 'https://www.linkedin.com/in/poster-1',
      type: 'person',
    });
  });

  it('has no apply URL for Easy Apply', () => {
    expect(record(job({ applyType: 'EASY_APPLY' })).applyUrl).toBeNull();
  });

  it('has no apply URL when the external URL is on LinkedIn', () => {
    expect(
      record(job({ applyUrl: 'https://es.linkedin.com/jobs/view/1234567' }))
        .applyUrl,
    ).toBeNull();
  });

  it('keeps an external apply URL unchanged', () => {
    const applyUrl =
      'https://sii.pl/en/job-ads/id/38247/?sii_source=10&utm_source=linkedin.com#apply-contact-form';
    expect(record(job({ applyUrl })).applyUrl).toBe(applyUrl);
  });

  it('treats sentinels and blanks as null', () => {
    const r = record(job({ title: 'undefined', location: '  ' }));
    expect(r.title).toBeNull();
    expect(r.location).toBeNull();
  });

  it('is invalid without a title and a description', () => {
    const result = job({ title: '', description: '', descriptionHtml: '' });
    expect('invalid' in result && result.invalid).toMatch(/^normalize:/);
  });

  it('is deterministic whatever the key order', () => {
    const shuffled = Object.fromEntries(Object.entries(linkedinJob).reverse());
    expect(
      JSON.stringify(normalize(Channel.LINKEDIN_JOB_BOARD, shuffled)),
    ).toBe(JSON.stringify(job()));
  });
});

describe('normalize LinkedIn job board, cheap_scraper items', () => {
  const cheap = (overrides: Record<string, unknown> = {}) =>
    record(
      normalize(Channel.LINKEDIN_JOB_BOARD, { ...cheapJob, ...overrides }),
    );

  it('maps the cheap_scraper field names', () => {
    expect(cheap()).toMatchObject({
      kind: 'job',
      title: 'Full-Stack Software Engineer, Inference',
      companyName: 'Acme',
      companyUrl: 'https://ca.linkedin.com/company/acme',
      location: 'Montreal, Quebec, Canada',
      contractType: 'Full-time',
      experienceLevel: 'Not Applicable',
      sector: 'Software Development',
      publishedAt: '2026-11-04',
      postingUrl: 'https://www.linkedin.com/jobs/view/4354494117',
      poster: {
        name: 'Poster Name 1',
        profileUrl: 'https://www.linkedin.com/in/poster-1',
        type: 'person',
      },
    });
  });

  it("drops the description's Show more Show less trailer", () => {
    expect(cheap().descriptionText).toBe('Build APIs.');
  });

  it('keeps salaryInfo as the stated text, with no bounds or currency', () => {
    expect(cheap().salary).toEqual({
      text: '$69100.00 - $129200.00',
      min: null,
      max: null,
      currency: null,
      period: null,
      providedByEmployer: null,
    });
    expect(cheap({ salaryInfo: [] }).salary).toBeNull();
  });

  it('has no apply URL: an external job links to its LinkedIn page', () => {
    expect(cheap().applyUrl).toBeNull();
  });

  it('keeps an apply URL off LinkedIn', () => {
    const applyUrl = 'https://jobs.ashbyhq.com/acme/0b1c2d3e';
    expect(cheap({ applyUrl }).applyUrl).toBe(applyUrl);
  });

  it('is invalid without a title and a description', () => {
    const result = normalize(Channel.LINKEDIN_JOB_BOARD, {
      ...cheapJob,
      jobTitle: '',
      jobDescription: 'Show more Show less',
    });
    expect('invalid' in result && result.invalid).toMatch(/^normalize:/);
  });
});

describe('normalize LinkedIn job board, item format', () => {
  it('is invalid when the item has no known actor format', () => {
    expect(
      normalize(Channel.LINKEDIN_JOB_BOARD, {
        jobUrl: 'https://www.linkedin.com/jobs/view/1',
      }),
    ).toEqual({ invalid: 'normalize: unknown LinkedIn job item format' });
  });

  it('estimates the posted time of a cheap_scraper item from its "ago" text', () => {
    const item = {
      ...cheapJob,
      postedTime: '8 hours ago',
      publishedAt: '2026-11-10T00:00:00.000Z',
    };
    expect(record(normalize(Channel.LINKEDIN_JOB_BOARD, item)).postedAt).toBe(
      '2026-11-10T12:32:26.671Z',
    );
    const { postedTime: _unused, ...without } = item;
    expect(
      record(normalize(Channel.LINKEDIN_JOB_BOARD, without)).postedAt,
    ).toBeNull();
  });

  it('maps an old bebity item as before', () => {
    // No `postedTime`: such an item states a date only.
    const { postedTime: _unused, ...old } = linkedinJob;
    expect(
      record(normalize(Channel.LINKEDIN_JOB_BOARD, old)).postedAt,
    ).toBeNull();
  });

  it('maps a current bebity item', () => {
    const r = record(normalize(Channel.LINKEDIN_JOB_BOARD, bebityCurrent));
    expect(r).toMatchObject({
      title: bebityCurrent.title,
      companyName: bebityCurrent.companyName,
      location: bebityCurrent.location,
      applyUrl: null,
      postingUrl: `https://www.linkedin.com/jobs/view/${bebityCurrent.id}`,
      postedAt: new Date(scrapedAt.getTime() - 46 * 60_000).toISOString(),
    });
  });

  it('maps a bebity item by bebity names even when it carries a jobId', () => {
    const r = record(job({ jobId: '999' }));
    expect(r.postingUrl).toBe('https://www.linkedin.com/jobs/view/4012345678');
    expect(r.title).toBe('Senior Backend Engineer');
  });
});

describe('normalize LinkedIn posts', () => {
  it('takes the exact posted time when the post carries one', () => {
    expect(record(post()).postedAt).toBe('2026-10-31T10:00:00.000Z');
  });

  it('estimates the posted time from the "ago" text when the date is absent', () => {
    const r = record(
      post({
        postedAt: { postedAgoText: '2 hours ago • Visible to anyone' },
      }),
    );
    expect(r.postedAt).toBe('2026-11-10T18:32:26.671Z');
  });

  it('maps a post without inventing job facts', () => {
    const r = record(post());
    expect(r).toMatchObject({
      kind: 'post',
      title: null,
      companyName: null,
      location: null,
      descriptionText: "We're hiring a senior Node.js engineer. DM me.",
      publishedAt: '2026-10-31',
      postingUrl: linkedinPost.linkedinUrl,
      applyUrl: null,
      closed: false,
    });
    expect(r.poster).toEqual({
      name: 'Jane Doe',
      profileUrl: 'https://www.linkedin.com/in/jane-doe',
      type: 'person',
    });
  });

  it('keeps a company author as the poster, never the employer', () => {
    const r = record(
      post({ author: { ...linkedinPost.author, type: 'company' } }),
    );
    expect(r.poster?.type).toBe('company');
    expect(r.companyName).toBeNull();
  });

  it('is invalid without a post URL', () => {
    expect('invalid' in post({ linkedinUrl: null })).toBe(true);
  });
});

describe('LinkedIn job format order', () => {
  const newFields = {
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

  it('leaves the new fields null for bebity and cheap_scraper items', () => {
    expect(record(job())).toMatchObject(newFields);
    expect(
      record(normalize(Channel.LINKEDIN_JOB_BOARD, cheapJob)),
    ).toMatchObject(newFields);
  });

  it("maps a harvestapi item by its own mapper, not bebity's", () => {
    const r = record(normalize(Channel.LINKEDIN_JOB_BOARD, harvestJobs[0]));
    expect(r.listingState).toBe('LISTED');
    expect(r.company).not.toBeNull();
  });
});
