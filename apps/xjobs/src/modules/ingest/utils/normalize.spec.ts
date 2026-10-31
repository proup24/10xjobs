import { Channel } from 'src/common/enums';
import { normalizeItem } from './normalize';
import type { CollectedJob } from '../types';

const ashbyId = '12345678-abcd-4000-8000-123456789abc';
const base: CollectedJob = {
  source: 'linkedin-jobs',
  sourceJobId: '123',
  url: 'https://www.linkedin.com/jobs/view/engineer-123/?trk=search',
  applyUrl: null,
  title: 'Engineer',
  company: 'Acme',
  location: 'Remote',
  postedAt: null,
  postedAtPrecision: 'day',
  description: 'Build APIs',
  contact: null,
  search: 'typescript in Germany',
  raw: { id: '123' },
};

describe('ingest normalization', () => {
  it('normalizes LinkedIn jobs without losing original evidence', () => {
    const job = normalizeItem(Channel.LINKEDIN_JOB_BOARD, base);
    expect(job).toMatchObject({
      externalId: '123',
      url: 'https://www.linkedin.com/jobs/view/123',
      title: 'Engineer',
      company: 'Acme',
      kind: 'job',
      description: 'Build APIs',
      raw: base.raw,
    });
  });

  it('keeps posts distinct from jobs and authors distinct from companies', () => {
    const raw = {
      content: 'Hiring engineers\nApply today',
      author: { name: 'Jane', type: 'profile', publicIdentifier: 'jane' },
      postedAt: { date: '2026-10-30T12:00:00Z' },
      article: { link: `https://jobs.ashbyhq.com/acme/${ashbyId}` },
    };
    const job = normalizeItem(Channel.LINKEDIN_POSTS, {
      ...base,
      source: 'linkedin-posts',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
      company: 'Jane',
      postedAtPrecision: 'hour',
      raw,
    });
    expect(job).toMatchObject({
      kind: 'post',
      title: 'Hiring engineers',
      company: null,
      authorName: 'Jane',
      authorUrl: 'https://www.linkedin.com/in/jane',
      description: raw.content,
      postedAtPrecision: 'hour',
      ats: { provider: 'ashby', tenantKey: 'acme', postingId: ashbyId },
    });
    expect(job.postedAt?.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('converts Ashby HTML to text and preserves the raw payload', () => {
    const raw = {
      posting: { employmentType: 'FullTime', publishedDate: '2026-10-29' },
    };
    const job = normalizeItem(Channel.ASHBY, {
      ...base,
      source: 'ashby',
      sourceJobId: ashbyId,
      url: `https://jobs.ashbyhq.com/acme/${ashbyId}/application?utm_source=test`,
      description: '<p>Build &amp; maintain APIs</p><script>alert(1)</script>',
      raw,
    });
    expect(job.description).toBe('Build & maintain APIs');
    expect(job).toMatchObject({
      raw,
      ats: { provider: 'ashby', tenantKey: 'acme', postingId: ashbyId },
      applyUrl: `https://jobs.ashbyhq.com/acme/${ashbyId}`,
    });
  });

  it('uses Greenhouse board identity and canonicalizes supported aliases', () => {
    const job = normalizeItem(Channel.GREEN_HOUSE, {
      ...base,
      source: 'greenhouse',
      url: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=abc',
      raw: { posting: { first_published: '2026-10-28T10:00:00Z' } },
    });
    expect(job).toMatchObject({
      url: 'https://job-boards.greenhouse.io/acme/jobs/123',
      ats: { provider: 'greenhouse', tenantKey: 'acme', postingId: '123' },
    });
  });

  it('uses URL fallback for blank or sentinel source IDs', () => {
    for (const sourceJobId of ['', ' ', 'undefined', 'null']) {
      expect(
        normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, sourceJobId })
          .externalId,
      ).toBeNull();
    }
  });

  it('maps the contact object and stores blank title or company as null', () => {
    const job = normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
      ...base,
      title: ' ',
      company: '',
      contact: {
        name: 'Jane Recruiter',
        url: 'https://www.linkedin.com/in/jane?trk=x',
      },
    });
    expect(job).toMatchObject({
      title: null,
      company: null,
      contactName: 'Jane Recruiter',
      contactUrl: 'https://www.linkedin.com/in/jane',
      authorName: null,
    });
  });

  it('rejects items whose source does not match the lookup channel', () => {
    expect(() => normalizeItem(Channel.LINKEDIN_POSTS, base)).toThrow(
      'Source does not match lookup query',
    );
  });

  it.each([
    'sourceJobId',
    'title',
    'company',
    'postedAtPrecision',
    'search',
    'contact',
    'applyUrl',
  ] as const)('rejects items missing the required %s field', (field) => {
    const { [field]: _omitted, ...item } = base;
    expect(() => normalizeItem(Channel.LINKEDIN_JOB_BOARD, item)).toThrow(
      'Malformed collector item',
    );
  });

  it('rejects a blank search and a partial contact', () => {
    for (const item of [
      { ...base, search: ' ' },
      { ...base, contact: { name: 'Jane', url: '' } },
      { ...base, source: 'indeed' },
    ]) {
      expect(() => normalizeItem(Channel.LINKEDIN_JOB_BOARD, item)).toThrow(
        'Malformed collector item',
      );
    }
  });

  it.each([
    'http://localhost/123',
    'https://linkedin.com.evil.test/jobs/view/123',
    'https://www.linkedin.com/jobs/search/',
    'https://user:secret@www.linkedin.com/jobs/view/123',
    'https://www.linkedin.com:444/jobs/view/123',
  ])('rejects unsupported source URL %s', (url) => {
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, url }),
    ).toThrow();
  });

  it('rejects mismatched source identity, empty text, malformed optional fields and non-JSON raw', () => {
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
        ...base,
        sourceJobId: '456',
      }),
    ).toThrow();
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, description: ' ' }),
    ).toThrow();
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, title: {} }),
    ).toThrow();
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
        ...base,
        raw: { invalid: BigInt(1) },
      }),
    ).toThrow();
    expect(() =>
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
        ...base,
        raw: { invalid: undefined },
      }),
    ).toThrow();
  });

  it('does not parse plain-text comparison operators as HTML', () => {
    expect(
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
        ...base,
        description: 'Experience < 5 years & Python > 3',
      }).description,
    ).toBe('Experience < 5 years & Python > 3');
  });

  it('rejects impossible dates and timestamps without a timezone', () => {
    for (const postedAt of ['2026-02-31', '2026-10-30T12:00:00']) {
      expect(() =>
        normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, postedAt }),
      ).toThrow();
    }
  });

  it('preserves a group post URL even when the actor activity ID is different', () => {
    const job = normalizeItem(Channel.LINKEDIN_POSTS, {
      ...base,
      source: 'linkedin-posts',
      url: 'https://www.linkedin.com/feed/update/urn:li:groupPost:456-789/',
      raw: { content: 'We are hiring' },
    });
    expect(job.externalId).toBe('123');
    expect(job.url).toBe(
      'https://www.linkedin.com/feed/update/urn:li:groupPost:456-789/',
    );
  });

  it('decodes Greenhouse transport HTML and recovers its company without changing raw evidence', () => {
    const raw = {
      posting: {
        content: '&lt;p&gt;Build &amp;amp; maintain APIs&lt;/p&gt;',
        company_name: 'Acme',
      },
    };
    const job = normalizeItem(Channel.GREEN_HOUSE, {
      ...base,
      source: 'greenhouse',
      company: 'Unknown',
      url: 'https://boards.greenhouse.io/acme/jobs/123',
      description: raw.posting.content,
      raw,
    });
    expect(job.description).toBe('Build & maintain APIs');
    expect(job.company).toBe('Acme');
    expect(job.raw).toEqual(raw);
  });

  it('does not invent hour precision for a date-only publication value', () => {
    expect(
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
        ...base,
        postedAt: '2026-10-30',
        postedAtPrecision: 'hour',
      }).postedAtPrecision,
    ).toBe('day');
  });
});
