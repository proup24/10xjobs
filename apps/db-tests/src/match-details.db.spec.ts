import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  cleanupDetailedJobs,
  detailedDocument,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedProfile,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

// Detailed jobs reference the users' profiles, so they go before the users.
afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

const COLUMNS = [
  'matchId',
  'profileId',
  'jobId',
  'outcome',
  'unverified',
  'stackScore',
  'checks',
  'decidedAt',
  'kind',
  'title',
  'companyName',
  'companyUrl',
  'location',
  'salaryText',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'publishedAt',
  'firstSeenAt',
  'lastSeenAt',
  'closed',
  'postingUrl',
  'applyUrl',
  'posterName',
  'posterProfileUrl',
  'posterType',
  'descriptionText',
  'channels',
  'facts',
];

type Row = Record<string, unknown> & { jobId: string };
type Params = {
  p_profile_id: string;
  p_outcome?: string;
  p_since?: string;
  p_job_id?: string;
};

// The parts of detailedDocument() the expected facts are derived from.
type Fact<T> = { value: T; quote: string };
type Doc = {
  position: Fact<{ roleKind: string; title: string }>;
  seniority: Fact<string>;
  yearsRequired: Fact<{ min: number | null; max: number | null }>;
  arrangement: Fact<string>;
  openings: Array<{
    arrangements: string[];
    places: Array<{ kind: string; code: string }>;
    placeStrictness: string;
    timezones: unknown[];
    quote: string;
  }>;
  contractType: Fact<string>;
  salary: Fact<Record<string, unknown>>;
  techStack: Fact<{
    requirements: Array<{
      technology: { code: string | null; text: string };
      kind: string;
      importance: number;
      domain: string | null;
      years: unknown;
      group: string | null;
      quote: string;
    }>;
    groups: unknown[];
  }>;
  requiredLanguages: Fact<unknown[]>;
  workAuthorization: Fact<Record<string, unknown>>;
};

async function labelOf(table: string, code: string): Promise<string | null> {
  const { data, error } = await admin()
    .from(table)
    .select('label')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.label as string | undefined) ?? null;
}

/** Every key anywhere in a JSON value. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysIn(v)]);
  return [];
}

describe('match_details', () => {
  let a: TestUser;
  let b: TestUser;
  let profileA: string;
  let profileA2: string;
  let profileB: string;
  let jobShared: string;
  let jobA: string;
  let jobRejected: string;
  let jobOld: string;
  let jobMerged: string;
  let jobNobody: string;
  let jobEmptyQuote: string;

  const call = async (user: TestUser, params: Params): Promise<Row[]> => {
    const { data, error } = await user.client.rpc('match_details', params);
    if (error) throw new Error(error.message);
    return data as Row[];
  };
  const jobIds = (rows: Row[]) => rows.map((r) => r.jobId).sort();

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    profileB = await seedProfile(b.id);
    await publishProfile(profileB);

    const shared = await seedDetailedJob({
      channels: ['LINKEDIN_JOB_BOARD', 'ASHBY'],
    });
    await seedMatchOn(a.id, profileA, shared, {
      checks: { a: 1 },
      stackScore: 0.8,
    });
    await seedMatchOn(b.id, profileB, shared, {
      checks: { b: 1 },
      stackScore: 0.3,
    });
    const onlyA = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, onlyA);
    const rejected = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, rejected, { outcome: 'rejected' });
    const old = await seedDetailedJob({ lastSeenAt: '2026-01-01T00:00:00Z' });
    await seedMatchOn(a.id, profileA, old);
    const merged = await seedDetailedJob({ status: 'merged' });
    await seedMatchOn(a.id, profileA, merged);
    const nobody = await seedDetailedJob();
    const base = detailedDocument() as unknown as Doc;
    const emptyQuote = await seedDetailedJob({
      document: {
        ...detailedDocument(),
        seniority: { ...base.seniority, quote: '' },
      },
    });
    // On a second profile of A, so the other cases' job sets stay as listed.
    profileA2 = await seedProfile(a.id);
    await publishProfile(profileA2);
    await seedMatchOn(a.id, profileA2, emptyQuote);

    jobShared = shared.jobId;
    jobA = onlyA.jobId;
    jobRejected = rejected.jobId;
    jobOld = old.jobId;
    jobMerged = merged.jobId;
    jobNobody = nobody.jobId;
    jobEmptyQuote = emptyQuote.jobId;
  });

  it("returns the owner's qualified matches with job details", async () => {
    const rows = await call(a, { p_profile_id: profileA });
    expect(jobIds(rows)).toEqual([jobShared, jobA, jobOld].sort());
    const row = rows.find((r) => r.jobId === jobShared)!;
    expect(row).toMatchObject({
      title: 'Senior Backend Engineer',
      postingUrl: 'https://acme.example/job',
      descriptionText: 'Build backend services.',
      checks: { a: 1 },
      stackScore: 0.8,
      channels: ['ASHBY', 'LINKEDIN_JOB_BOARD'],
    });
  });

  it('returns rejected matches when asked', async () => {
    const rows = await call(a, {
      p_profile_id: profileA,
      p_outcome: 'rejected',
    });
    expect(jobIds(rows)).toEqual([jobRejected]);
  });

  it('applies the since window', async () => {
    const rows = await call(a, {
      p_profile_id: profileA,
      p_since: '2026-06-01T00:00:00Z',
    });
    expect(jobIds(rows)).toEqual([jobShared, jobA].sort());
  });

  it('narrows to one job', async () => {
    const rows = await call(a, { p_profile_id: profileA, p_job_id: jobA });
    expect(jobIds(rows)).toEqual([jobA]);
  });

  it('hides merged jobs', async () => {
    for (const p_outcome of ['qualified', 'rejected']) {
      const rows = await call(a, { p_profile_id: profileA, p_outcome });
      expect(jobIds(rows)).not.toContain(jobMerged);
    }
    expect(
      await call(a, { p_profile_id: profileA, p_job_id: jobMerged }),
    ).toEqual([]);
  });

  it("returns nothing for another user's profile", async () => {
    expect(await call(b, { p_profile_id: profileA })).toEqual([]);
    expect(await call(b, { p_profile_id: profileA, p_job_id: jobA })).toEqual(
      [],
    );
  });

  it('shows each user only their own match on a shared job', async () => {
    const rows = await call(b, { p_profile_id: profileB });
    expect(jobIds(rows)).toEqual([jobShared]);
    expect(rows[0]).toMatchObject({ checks: { b: 1 }, stackScore: 0.3 });
  });

  it('never returns an unmatched job', async () => {
    for (const [user, profileId] of [
      [a, profileA],
      [a, profileB],
      [b, profileA],
      [b, profileB],
    ] as const) {
      for (const p_outcome of ['qualified', 'rejected'])
        expect(
          await call(user, {
            p_profile_id: profileId,
            p_outcome,
            p_job_id: jobNobody,
          }),
        ).toEqual([]);
    }
  });

  it('rejects anonymous callers', async () => {
    const { data, error } = await anon().rpc('match_details', {
      p_profile_id: profileA,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/);
    expect(data).toBeNull();
  });

  it('exposes no helper function', async () => {
    const { data, error } = await a.client.rpc('match_facts', { doc: {} });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('exposes only allowed columns', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    expect(Object.keys(row).sort()).toEqual([...COLUMNS].sort());
    expect(JSON.stringify(row)).not.toContain('secret-');
  });

  it('builds the facts', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    const d = detailedDocument() as unknown as Doc;
    const opening = d.openings[0];
    const [region, country] = opening.places;
    const tech = d.techStack.value;

    const expected = {
      position: {
        roleKind: {
          code: d.position.value.roleKind,
          label: await labelOf('role_kinds', d.position.value.roleKind),
        },
        title: d.position.value.title,
        quote: d.position.quote,
      },
      seniority: {
        code: d.seniority.value,
        label: await labelOf('seniorities', d.seniority.value),
        quote: d.seniority.quote,
      },
      yearsRequired: { ...d.yearsRequired.value, quote: d.yearsRequired.quote },
      arrangement: {
        code: d.arrangement.value,
        label: await labelOf('arrangements', d.arrangement.value),
        quote: d.arrangement.quote,
      },
      openings: [
        {
          arrangements: [
            {
              code: opening.arrangements[0],
              label: await labelOf('arrangements', opening.arrangements[0]),
            },
          ],
          places: [
            {
              kind: 'region',
              code: region.code,
              label: await labelOf('regions', region.code),
            },
            { kind: 'country', code: country.code, label: null },
          ],
          placeStrictness: opening.placeStrictness,
          timezones: opening.timezones,
          quote: opening.quote,
        },
      ],
      contractType: {
        code: d.contractType.value,
        label: await labelOf('contract_types', d.contractType.value),
        quote: d.contractType.quote,
      },
      engagement: null,
      contractMonths: null,
      salary: { ...d.salary.value, quote: d.salary.quote },
      techStack: {
        requirements: await Promise.all(
          tech.requirements.map(async (r) => ({
            technology: {
              code: r.technology.code,
              label: r.technology.code
                ? await labelOf('tech_tags', r.technology.code)
                : r.technology.text,
              text: r.technology.text,
            },
            kind: r.kind,
            importance: r.importance,
            domain: r.domain,
            years: r.years,
            group: r.group,
            quote: r.quote,
          })),
        ),
        groups: tech.groups,
        quote: d.techStack.quote,
      },
      requiredLanguages: {
        languages: d.requiredLanguages.value,
        quote: d.requiredLanguages.quote,
      },
      workAuthorization: {
        ...d.workAuthorization.value,
        quote: d.workAuthorization.quote,
      },
    };

    expect(country.code).toBe('ZZ');
    expect(expected.seniority.label).not.toBeNull();
    expect(expected.techStack.requirements[1].technology).toEqual({
      code: null,
      label: 'Dynatrace',
      text: 'Dynatrace',
    });
    expect(row.facts).toEqual(expected);
    const keys = keysIn(row.facts);
    expect(keys).not.toContain('confidence');
    expect(keys).not.toContain('decidedBy');
  });

  it('turns empty quotes into null', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA2,
      p_job_id: jobEmptyQuote,
    });
    expect(
      (row.facts as { seniority: { quote: unknown } }).seniority.quote,
    ).toBeNull();
  });
});
