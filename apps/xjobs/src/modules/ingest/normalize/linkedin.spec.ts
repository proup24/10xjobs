import { Channel } from 'src/common/enums';
import linkedinJob from '../utils/fixtures/linkedin-job.json';
import linkedinPost from '../utils/fixtures/linkedin-post.json';
import { normalize, type NormalizedRecord } from '.';

const job = (overrides: Record<string, unknown> = {}) =>
  normalize(Channel.LINKEDIN_JOB_BOARD, { ...linkedinJob, ...overrides });
const post = (overrides: Record<string, unknown> = {}) =>
  normalize(Channel.LINKEDIN_POSTS, { ...linkedinPost, ...overrides });

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

describe('normalize LinkedIn posts', () => {
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
