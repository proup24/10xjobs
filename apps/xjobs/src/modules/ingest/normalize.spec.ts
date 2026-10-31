import { Channel } from 'src/common/enums';
import { normalizeItem } from './normalize';

const ashbyId = '12345678-abcd-4000-8000-123456789abc';
const base = {
  externalId: '123',
  url: 'https://www.linkedin.com/jobs/view/engineer-123/?trk=search',
  title: 'Engineer',
  company: 'Acme',
  description: 'Build APIs',
  location: 'Remote',
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
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
      company: 'Jane',
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
      externalId: ashbyId,
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
      url: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=abc',
      raw: { posting: { first_published: '2026-10-28T10:00:00Z' } },
    });
    expect(job).toMatchObject({
      url: 'https://job-boards.greenhouse.io/acme/jobs/123',
      ats: { provider: 'greenhouse', tenantKey: 'acme', postingId: '123' },
    });
  });

  it('uses URL fallback for absent or sentinel source IDs', () => {
    for (const externalId of [undefined, '', 'undefined', 'null']) {
      expect(
        normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, externalId })
          .externalId,
      ).toBeNull();
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
      normalizeItem(Channel.LINKEDIN_JOB_BOARD, { ...base, externalId: '456' }),
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
      }).postedAtPrecision,
    ).toBe('day');
  });
});
