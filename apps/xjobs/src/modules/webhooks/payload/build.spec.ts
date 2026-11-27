import type { Labels } from '@xjobs/database/matches';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';
import {
  buildMatchPayload,
  buildTestPayload,
  type PayloadInput,
} from './build';

const labels: Labels = {
  positions: [{ value: 'backend_engineer', label: 'Backend engineer' }],
  seniorities: [{ value: 'senior', label: 'Senior' }],
  techs: [],
  countries: [{ value: 'DE', label: 'Germany' }],
  regions: [{ value: 'EUROPE', label: 'Europe' }],
  cities: [{ value: 'c1', label: 'Berlin, Germany' }],
  languages: [],
  currencies: [],
  contractTypes: [],
};
const ctx = {
  deliveryId: 'd1',
  createdAt: new Date('2026-11-16T10:00:00Z'),
  webAppUrl: 'https://app.example.com',
};

const input = (over: Partial<PayloadInput> = {}): PayloadInput => ({
  profile: { id: 'p1', position: 'backend_engineer' },
  match: {
    id: 'm1',
    unverified: false,
    stackScore: 0.72,
    trigger: 'decision',
    checks: [
      { rule: 'seniority', outcome: 'pass', reason: 'senior is wanted' },
      { rule: 'stack', outcome: 'fail', reason: 'too little overlap' },
    ],
  },
  job: {
    id: 'j1',
    kind: 'job',
    title: 'Senior Backend Engineer',
    companyName: 'Acme',
    companyUrl: 'https://acme.test',
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
    applyUrl: null,
    postedAt: new Date('2026-11-15T08:00:00Z'),
    firstSeenAt: new Date('2026-11-16T09:00:00Z'),
    descriptionText: 'Build things.',
  },
  facts: {
    seniority: { value: 'senior' },
    contractType: { value: 'full_time' },
    salary: {
      value: { min: 80000, max: 100000, currency: 'EUR', period: 'year' },
    },
    techStack: {
      value: {
        requirements: [
          { technology: { code: 'node', text: 'Node' } },
          { technology: { code: null, text: 'Foo' } },
          { technology: { code: 'node', text: 'Node' } },
        ],
      },
    },
    requiredLanguages: { value: [{ lang: 'en', level: 'fluent' }] },
    openings: [
      {
        arrangements: ['remote', 'hybrid'],
        places: [
          { kind: 'region', code: 'EUROPE' },
          { kind: 'city', name: 'Berlin', cityId: 'c1' },
          { kind: 'worldwide' },
        ],
      },
    ],
  },
  ...over,
  post: over.post ?? null,
});

describe('buildMatchPayload', () => {
  it("maps a full input to the spec's shape", () => {
    const p = buildMatchPayload(input(), labels, ctx);
    expect(p.version).toBe(1);
    expect(p.event).toBe('match.qualified');
    expect(Object.keys(p)).toEqual([
      'version',
      'event',
      'deliveryId',
      'createdAt',
      'profile',
      'trigger',
      'match',
      'job',
      'post',
      'links',
    ]);
    expect(p.createdAt).toBe('2026-11-16T10:00:00.000Z');
    expect(p.profile).toEqual({
      id: 'p1',
      position: 'backend_engineer',
      label: 'Backend engineer',
    });
    expect(p.match.reasons).toEqual([
      { check: 'seniority', outcome: 'pass', summary: 'Senior is wanted' },
      { check: 'stack', outcome: 'fail', summary: 'Too little overlap' },
    ]);
    expect(p.job).toEqual({
      id: 'j1',
      source: 'job_board',
      title: 'Senior Backend Engineer',
      company: { name: 'Acme', url: 'https://acme.test' },
      postingUrl: 'https://www.linkedin.com/jobs/view/1',
      applyUrl: null,
      postedAt: '2026-11-15T08:00:00.000Z',
      firstSeenAt: '2026-11-16T09:00:00.000Z',
      locations: [
        {
          arrangement: 'remote',
          places: ['Europe', 'Berlin, Germany', 'Worldwide'],
        },
        {
          arrangement: 'hybrid',
          places: ['Europe', 'Berlin, Germany', 'Worldwide'],
        },
      ],
      seniority: 'senior',
      contractType: 'full_time',
      salary: { min: 80000, max: 100000, currency: 'EUR', period: 'year' },
      techStack: ['node', 'Foo'],
      languages: ['en'],
      description: 'Build things.',
    });
    expect(p.post).toBeNull();
    expect(p.links.match).toBe('https://app.example.com/?job=j1');
  });

  it('a post role is a social post with its author, sharers and how to apply', () => {
    const person = (key: string, name: string) => ({
      key: `profile:${key}`,
      name,
      profileUrl: `https://www.linkedin.com/in/${key}`,
    });
    const p = buildMatchPayload(
      input({
        job: { ...input().job, kind: 'post_role' },
        facts: null,
        post: {
          url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
          sources: [
            {
              author: person('sam', 'Sam Sharer'),
              text: 'Look at this',
              original: { author: person('olga', 'Olga Original') },
            },
            {
              author: person('tim', 'Tim Two'),
              original: { author: person('olga', 'Olga Original') },
            },
          ],
          howToApply: {
            kinds: ['connect_dm_comment', 'external_link'],
            email: null,
            links: ['https://acme.test/apply'],
            quote: 'DM me',
          },
        },
      }),
      labels,
      ctx,
    );
    expect(p.version).toBe(1);
    expect(p.job.source).toBe('social_post');
    expect(p.links.match).toBe('https://app.example.com/posts?job=j1');
    expect(p.post).toEqual({
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
      author: {
        name: 'Olga Original',
        url: 'https://www.linkedin.com/in/olga',
      },
      sharers: [
        { name: 'Sam Sharer', url: 'https://www.linkedin.com/in/sam' },
        { name: 'Tim Two', url: 'https://www.linkedin.com/in/tim' },
      ],
      howToApply: {
        kinds: ['connect_dm_comment', 'external_link'],
        email: null,
        links: ['https://acme.test/apply'],
      },
      rescued: false,
    });
  });

  it('a plain post has its own author, no sharers, and nulls for what it lacks', () => {
    const p = buildMatchPayload(
      input({
        job: { ...input().job, kind: 'post_role' },
        post: {
          url: null,
          sources: [{ author: { name: 'Olga Original', profileUrl: null } }],
          howToApply: null,
        },
      }),
      labels,
      ctx,
    );
    expect(p.post).toEqual({
      url: null,
      author: { name: 'Olga Original', url: null },
      sharers: [],
      howToApply: { kinds: [], email: null, links: [] },
      rescued: false,
    });
  });

  it('unknown facts are null, not missing', () => {
    const p = buildMatchPayload(
      input({
        facts: null,
        job: { ...input().job, descriptionText: null, postedAt: null },
      }),
      labels,
      ctx,
    );
    expect(Object.keys(p.job)).toEqual(
      Object.keys(buildMatchPayload(input(), labels, ctx).job),
    );
    expect(p.job.salary).toBeNull();
    expect(p.job).toMatchObject({
      locations: null,
      seniority: null,
      contractType: null,
      techStack: null,
      languages: null,
      description: null,
      postedAt: null,
    });
  });

  it('cuts the description at 20 000 chars', () => {
    const long = 'x'.repeat(WEBHOOK_CONFIG.maxDescriptionChars + 500);
    const p = buildMatchPayload(
      input({ job: { ...input().job, descriptionText: long } }),
      labels,
      ctx,
    );
    expect(p.job.description).toHaveLength(20_000);
  });

  it('links.match is null without WEB_APP_URL', () => {
    const p = buildMatchPayload(input(), labels, { ...ctx, webAppUrl: null });
    expect(p.links).toEqual({ match: null });
  });
});

describe('buildTestPayload', () => {
  it('a test payload without a sample uses the fixed job', () => {
    const p = buildTestPayload(null, labels, ctx);
    expect(p.event).toBe('test');
    expect(p.deliveryId).toBe('d1');
    expect(p.job.title).toContain('example');
    expect(p.job.salary).toEqual({
      min: 80000,
      max: 100000,
      currency: 'EUR',
      period: 'year',
    });
  });

  it('uses the sample when there is one', () => {
    const p = buildTestPayload(input(), labels, ctx);
    expect(p.event).toBe('test');
    expect(p.job.id).toBe('j1');
  });
});

describe('buildMatchPayload edge cases', () => {
  it('maps the unstated sentinel to null', () => {
    const p = buildMatchPayload(
      input({
        facts: {
          seniority: { value: 'unstated' },
          contractType: { value: 'unstated' },
          openings: [
            {
              arrangements: ['unstated'],
              places: [{ kind: 'country', code: 'DE' }],
            },
          ],
        },
      }),
      labels,
      ctx,
    );
    expect(p.job.seniority).toBeNull();
    expect(p.job.contractType).toBeNull();
    expect(p.job.locations).toEqual([
      { arrangement: null, places: ['Germany'] },
    ]);
  });

  it('empty openings give an empty list, not null', () => {
    const p = buildMatchPayload(
      input({ facts: { openings: [] } }),
      labels,
      ctx,
    );
    expect(p.job.locations).toEqual([]);
  });

  it('a position without a label has a null label', () => {
    const p = buildMatchPayload(
      input({ profile: { id: 'p1', position: 'mystery' } }),
      labels,
      ctx,
    );
    expect(p.profile.label).toBeNull();
  });

  it('does not cut a surrogate pair at the description cap', () => {
    const max = WEBHOOK_CONFIG.maxDescriptionChars;
    const text = 'x'.repeat(max - 1) + '\u{1F600}';
    const p = buildMatchPayload(
      input({ job: { ...input().job, descriptionText: text } }),
      labels,
      ctx,
    );
    expect(p.job.description).toBe('x'.repeat(max - 1));
  });
});
