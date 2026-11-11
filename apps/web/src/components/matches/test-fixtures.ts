import type { Labels } from '@/lib/matches/checks';
import type { MatchRow } from '@/lib/matches/group';

/** Test data for the matches components; the shapes are what `match_details` returns. */

export const NOW = '2026-11-10T21:00:00.000Z';
export const hoursAgo = (h: number) =>
  new Date(new Date(NOW).getTime() - h * 3600_000).toISOString();

export const P1 = '11111111-1111-4111-8111-111111111111';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P3 = '33333333-3333-4333-8333-333333333333';

export const labels: Labels = {
  positions: [{ value: 'fullstack_engineer', label: 'Full-stack engineer' }],
  seniorities: [{ value: 'senior', label: 'Senior' }],
  techs: [
    { value: 'typescript', label: 'TypeScript', searchable: true },
    { value: 'react', label: 'React', searchable: true },
    { value: 'go', label: 'Go', searchable: true },
  ],
  countries: [{ value: 'FR', label: 'France' }],
  regions: [{ value: 'EU', label: 'Europe' }],
  cities: [],
};

export const checks = [
  {
    rule: 'position',
    outcome: 'pass',
    jobValue: 'fullstack_engineer',
    profileValue: 'fullstack_engineer',
    reason: 'job role fullstack_engineer matches your position',
  },
  {
    rule: 'stack',
    outcome: 'pass',
    jobValue: ['typescript', 'go'],
    profileValue: ['typescript'],
    reason: 'job stack covered at 0.713: typescript',
    detail: {
      covered: ['typescript'],
      uncovered: ['go'],
      niceCovered: [],
      notComparable: ['Kubernetes'],
      score: 0.713,
    },
  },
];

export const facts = {
  position: {
    roleKind: { code: 'fullstack_engineer', label: 'Full-stack engineer' },
    title: 'Senior Full-stack Engineer',
    quote: null,
  },
  seniority: { code: 'senior', label: 'Senior', quote: null },
  yearsRequired: { min: 5, max: null, quote: null },
  arrangement: { code: 'remote', label: 'Remote', quote: null },
  openings: [
    {
      arrangements: [{ code: 'remote', label: 'Remote' }],
      places: [{ kind: 'region', code: 'EU', label: 'Europe' }],
      placeStrictness: null,
      timezones: [{ fromUtc: 0, toUtc: 2, label: 'CET' }],
      quote: null,
    },
  ],
  contractType: null,
  engagement: null,
  contractMonths: null,
  salary: null,
};

// The generated row type says non-null; the columns are nullable in Postgres.
type Over = { [K in keyof MatchRow]?: MatchRow[K] | null };

export const matchRow = (over: Over = {}): MatchRow =>
  ({
    matchId: `m-${over.jobId ?? 'J'}-${over.profileId ?? P1}`,
    jobId: 'J',
    profileId: P1,
    outcome: 'qualified',
    kind: 'job',
    closed: false,
    unverified: false,
    channels: ['LINKEDIN_JOB_BOARD'],
    title: 'Senior Full-stack Engineer',
    companyName: 'Acme',
    companyUrl: null,
    location: 'Paris, France',
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
    applyUrl: null,
    posterName: null,
    posterProfileUrl: null,
    posterType: null,
    descriptionText: 'Line one\nLine two',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    postedAt: hoursAgo(3),
    publishedAt: null,
    firstSeenAt: hoursAgo(2),
    lastSeenAt: hoursAgo(1),
    decidedAt: hoursAgo(1),
    viewedAt: null,
    stackScore: 0.713,
    checks,
    facts,
    ...over,
  }) as MatchRow;
