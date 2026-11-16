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
    expect(p.links.match).toBe('https://app.example.com/?job=j1');
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
