import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  addExtraction,
  cleanupDetailedJobs,
  detailedDocument,
  publishProfile,
  seedDetailedJob,
  seedFactConflict,
  seedMatchOn,
  seedProfile,
  type SeededJob,
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
  'postedAt',
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
  'viewedAt',
  'facts',
  'conflicts',
  'reviewRule',
  'reviewField',
  'reviewChoice',
];

type Row = Record<string, unknown> & { jobId: string };
type Params = {
  p_profile_id?: string;
  p_outcome?: string;
  p_since?: string;
  p_job_id?: string;
  p_details?: boolean;
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
  let jobNewerExtraction: string;
  let jobEdge: string;
  let jobA2: string;
  let jobPosted: string;
  let jobUnposted: string;

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
      channels: ['ASHBY', 'ASHBY', 'LINKEDIN_JOB_BOARD'],
      sources: { arrangement: 'linkedin' },
    });
    await seedFactConflict(shared, {
      field: 'workplaceType',
      listingValue: 'onsite',
      descriptionValue: 'remote',
      winner: 'description',
    });
    await seedFactConflict(shared, {
      field: 'city',
      listingValue: 'Paris',
      descriptionValue: 'Lyon',
      winner: 'listing',
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

    // Matched on the older extraction; a newer one with another seniority must not leak in.
    const newer = await seedDetailedJob();
    await addExtraction(
      newer.jobId,
      {
        ...detailedDocument(),
        seniority: { ...base.seniority, value: 'junior', quote: 'Junior' },
      },
      'junior',
    );
    await seedMatchOn(a.id, profileA2, newer);
    // Place kinds and value-list rows that do not exist.
    const edgeDoc = detailedDocument() as unknown as Doc;
    const edge = await seedDetailedJob({
      document: {
        ...detailedDocument(),
        openings: [
          {
            ...edgeDoc.openings[0],
            places: [
              { kind: 'worldwide' },
              { kind: 'region', code: 'ZZREGION' },
              {
                kind: 'city',
                name: 'Lisbon',
                countryCode: 'PT',
                cityId: 'city-lisbon',
              },
              {
                kind: 'city',
                name: 'Nowhere',
                countryCode: null,
                cityId: null,
              },
            ],
            confidence: 'sure',
            decidedBy: 'generator',
          },
        ],
        techStack: {
          ...edgeDoc.techStack,
          value: {
            ...edgeDoc.techStack.value,
            requirements: [
              {
                ...edgeDoc.techStack.value.requirements[0],
                technology: { code: 'zz-not-a-tag', text: 'Zzz' },
              },
            ],
            groups: [],
          },
        },
      },
    });
    await seedMatchOn(a.id, profileA2, edge);
    // A second job on profileA2 only; jobA is also matched by profileA2.
    const a2 = await seedDetailedJob();
    await seedMatchOn(a.id, profileA2, a2);
    await seedMatchOn(a.id, profileA2, onlyA);
    const posted = await seedDetailedJob({
      postedAt: '2026-11-10T12:32:26.671Z',
    });
    await seedMatchOn(a.id, profileA2, posted);
    const unposted = await seedDetailedJob({ postedAt: null });
    await seedMatchOn(a.id, profileA2, unposted);
    jobA2 = a2.jobId;
    jobPosted = posted.jobId;
    jobUnposted = unposted.jobId;
    jobNewerExtraction = newer.jobId;
    jobEdge = edge.jobId;

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
    expect(
      error?.code === 'PGRST202' ||
        /Could not find the function/.test(error?.message ?? ''),
    ).toBe(true);
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
        source: 'description',
        quote: d.position.quote,
      },
      seniority: {
        code: d.seniority.value,
        label: await labelOf('seniorities', d.seniority.value),
        source: 'description',
        quote: d.seniority.quote,
      },
      yearsRequired: {
        ...d.yearsRequired.value,
        source: 'description',
        quote: d.yearsRequired.quote,
      },
      arrangement: {
        code: d.arrangement.value,
        label: await labelOf('arrangements', d.arrangement.value),
        source: 'linkedin',
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
          arrangementSource: 'description',
          placesSource: 'description',
          quote: opening.quote,
        },
      ],
      contractType: {
        code: d.contractType.value,
        label: await labelOf('contract_types', d.contractType.value),
        source: 'description',
        quote: d.contractType.quote,
      },
      engagement: null,
      contractMonths: null,
      salary: {
        ...d.salary.value,
        source: 'description',
        quote: d.salary.quote,
      },
      techStack: {
        requirements: await Promise.all(
          tech.requirements.map(async (r) => ({
            technology: {
              code: r.technology.code,
              label:
                (r.technology.code
                  ? await labelOf('tech_tags', r.technology.code)
                  : null) ?? r.technology.text,
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
        source: 'description',
        quote: d.techStack.quote,
      },
      requiredLanguages: {
        languages: d.requiredLanguages.value,
        source: 'description',
        quote: d.requiredLanguages.quote,
      },
      workAuthorization: {
        ...d.workAuthorization.value,
        source: 'description',
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

  it('returns facts from job_facts with their source', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    const facts = row.facts as Record<string, { source: string } | undefined>;
    expect(facts.arrangement?.source).toBe('linkedin');
    expect(facts.position?.source).toBe('description');
    expect(facts.salary?.source).toBe('description');
  });

  it('returns conflicts for a job', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    expect(row.conflicts).toEqual([
      {
        field: 'city',
        listingValue: 'Paris',
        descriptionValue: 'Lyon',
        winner: 'listing',
      },
      {
        field: 'workplaceType',
        listingValue: 'onsite',
        descriptionValue: 'remote',
        winner: 'description',
      },
    ]);
    const [other] = await call(a, { p_profile_id: profileA, p_job_id: jobA });
    expect(other.conflicts).toEqual([]);
  });

  it('a match without job_facts still returns, with null facts', async () => {
    const c = await createTestUser();
    const profileC = await seedProfile(c.id);
    await publishProfile(profileC);
    const bare = await seedDetailedJob({ noFacts: true });
    await seedMatchOn(c.id, profileC, bare);
    for (const p_details of [true, false]) {
      const rows = await call(c, { p_profile_id: profileC, p_details });
      expect(jobIds(rows)).toEqual([bare.jobId]);
      expect(rows[0].facts).toBeNull();
      expect(rows[0].conflicts ?? []).toEqual([]);
      expect(rows[0].title).toBe('Senior Backend Engineer');
    }
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

  it("takes the facts from job_facts, not the job's newest extraction", async () => {
    const rows = await call(a, {
      p_profile_id: profileA2,
      p_job_id: jobNewerExtraction,
    });
    expect(rows).toHaveLength(1);
    const facts = rows[0].facts as { seniority: { code: string } };
    expect(facts.seniority.code).toBe('senior');
  });

  it('lists a job once per channel, sorted', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    expect(row.channels).toEqual(['ASHBY', 'LINKEDIN_JOB_BOARD']);
  });

  it('covers every place kind and unknown value-list rows', async () => {
    const [row] = await call(a, {
      p_profile_id: profileA2,
      p_job_id: jobEdge,
    });
    const facts = row.facts as {
      openings: Array<{ places: unknown[] }>;
      techStack: { requirements: Array<{ technology: unknown }> };
    };
    expect(facts.openings[0].places).toEqual([
      { kind: 'worldwide' },
      { kind: 'region', code: 'ZZREGION', label: null },
      {
        kind: 'city',
        name: 'Lisbon',
        countryCode: 'PT',
        cityId: 'city-lisbon',
      },
      { kind: 'city', name: 'Nowhere', countryCode: null, cityId: null },
    ]);
    expect(facts.techStack.requirements[0].technology).toEqual({
      code: 'zz-not-a-tag',
      label: 'Zzz',
      text: 'Zzz',
    });
  });

  it("returns all the caller's profiles when no profile is given", async () => {
    const rows = await call(a, {});
    const pairs = rows.map((r) => `${r.profileId}:${r.jobId}`).sort();
    expect(pairs).toEqual(
      [
        [profileA, jobShared],
        [profileA, jobA],
        [profileA, jobOld],
        [profileA2, jobA],
        [profileA2, jobA2],
        [profileA2, jobEmptyQuote],
        [profileA2, jobNewerExtraction],
        [profileA2, jobEdge],
        [profileA2, jobPosted],
        [profileA2, jobUnposted],
      ]
        .map(([p, j]) => `${p}:${j}`)
        .sort(),
    );
    expect(rows.filter((r) => r.jobId === jobA)).toHaveLength(2);
    expect(rows.filter((r) => r.jobId === jobA2)).toHaveLength(1);
  });

  it("never returns another user's matches for a null profile", async () => {
    const rows = await call(b, {});
    expect(rows.map((r) => [r.profileId, r.jobId])).toEqual([
      [profileB, jobShared],
    ]);
  });

  it('returns the posted time', async () => {
    const [posted] = await call(a, {
      p_profile_id: profileA2,
      p_job_id: jobPosted,
    });
    expect(new Date(posted.postedAt as string).getTime()).toBe(
      new Date('2026-11-10T12:32:26.671Z').getTime(),
    );
    const [unposted] = await call(a, {
      p_profile_id: profileA2,
      p_job_id: jobUnposted,
    });
    expect(unposted.postedAt).toBeNull();
  });

  it("returns the caller's view time only", async () => {
    const { error } = await a.client
      .from('job_views')
      .insert({ userId: a.id, jobId: jobShared });
    if (error) throw new Error(error.message);
    const [rowA] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    expect(rowA.viewedAt).not.toBeNull();
    const [rowB] = await call(b, {
      p_profile_id: profileB,
      p_job_id: jobShared,
    });
    expect(rowB.viewedAt).toBeNull();
  });

  it('returns light list rows with p_details false', async () => {
    const [full] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
    });
    const [list] = await call(a, {
      p_profile_id: profileA,
      p_job_id: jobShared,
      p_details: false,
    });
    expect(Object.keys(list).sort()).toEqual([...COLUMNS].sort());
    const facts = full.facts as {
      arrangement: unknown;
      openings: { arrangements: unknown }[];
    };
    expect(list).toEqual({
      ...full,
      checks: null,
      descriptionText: null,
      conflicts: null,
      facts: {
        arrangement: facts.arrangement,
        openings: facts.openings.map((o) => ({ arrangements: o.arrangements })),
      },
    });
    expect(JSON.stringify(list)).not.toContain('secret-');
  });

  it('returns the same rows, caller only, with p_details false', async () => {
    const pairs = (rows: Row[]) =>
      rows.map((r) => `${r.profileId}:${r.jobId}`).sort();
    expect(pairs(await call(a, { p_details: false }))).toEqual(
      pairs(await call(a, {})),
    );
    const rowsB = await call(b, { p_details: false });
    expect(rowsB.map((r) => [r.profileId, r.jobId])).toEqual([
      [profileB, jobShared],
    ]);
  });

  describe('on its own user', () => {
    let c: TestUser;
    let profileC: string;
    beforeAll(async () => {
      c = await createTestUser();
      profileC = await seedProfile(c.id);
      await publishProfile(profileC);
    });
    const one = async (job: SeededJob): Promise<Row> => {
      await seedMatchOn(c.id, profileC, job);
      const rows = await call(c, {
        p_profile_id: profileC,
        p_job_id: job.jobId,
      });
      expect(rows).toHaveLength(1);
      return rows[0];
    };

    it('shows a job closed when its facts are closed or it has expired', async () => {
      const factsClosed = await one(
        await seedDetailedJob({ factsClosed: true }),
      );
      expect(factsClosed.closed).toBe(true);
      const expired = await one(
        await seedDetailedJob({ expiresAt: '2026-01-01T00:00:00Z' }),
      );
      expect(expired.closed).toBe(true);
      const open = await one(
        await seedDetailedJob({ expiresAt: '2999-01-01T00:00:00Z' }),
      );
      expect(open.closed).toBe(false);
      const [listRow] = await call(c, {
        p_profile_id: profileC,
        p_job_id: factsClosed.jobId,
        p_details: false,
      });
      expect(listRow.closed).toBe(true);
    });

    it('returns engagement and contract months', async () => {
      const base = detailedDocument() as Record<
        string,
        Record<string, unknown>
      >;
      const row = await one(
        await seedDetailedJob({
          document: {
            ...base,
            engagement: {
              ...base.engagement,
              value: 'contractor',
              quote: 'B2B',
            },
            contractMonths: {
              ...base.contractMonths,
              value: 6,
              quote: 'Six months',
            },
          },
        }),
      );
      const facts = row.facts as Record<string, unknown>;
      expect(facts.engagement).toEqual({
        code: 'contractor',
        label: await labelOf('engagements', 'contractor'),
        source: 'description',
        quote: 'B2B',
      });
      expect(facts.contractMonths).toEqual({
        months: 6,
        source: 'description',
        quote: 'Six months',
      });
    });

    it("returns each opening's arrangement and places sources", async () => {
      const row = await one(
        await seedDetailedJob({ openingSources: { places: 'linkedin' } }),
      );
      const facts = row.facts as { openings: Record<string, unknown>[] };
      expect(facts.openings[0]).toMatchObject({
        arrangementSource: 'description',
        placesSource: 'linkedin',
      });
      expect(facts.openings[0]).not.toHaveProperty('source');
    });

    it("never returns another job's conflicts", async () => {
      const first = await seedDetailedJob();
      const second = await seedDetailedJob();
      await seedFactConflict(first, {
        field: 'salary',
        listingValue: 'first',
        descriptionValue: 'first',
        winner: 'description',
      });
      await seedFactConflict(second, {
        field: 'places',
        listingValue: 'second',
        descriptionValue: 'second',
        winner: 'description',
      });
      expect((await one(first)).conflicts).toEqual([
        {
          field: 'salary',
          listingValue: 'first',
          descriptionValue: 'first',
          winner: 'description',
        },
      ]);
      expect((await one(second)).conflicts).toEqual([
        {
          field: 'places',
          listingValue: 'second',
          descriptionValue: 'second',
          winner: 'description',
        },
      ]);
    });
  });
});
