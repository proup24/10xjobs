import { randomUUID } from 'node:crypto';
import { admin } from './admin.js';

/** Valid required `profiles` fields; the owner is added by the caller. */
export const profileFields = () => ({
  position: 'backend_engineer',
  contractTypes: ['full_time'],
  locations: {
    remote: [
      { kind: 'region', code: 'MENA' },
      { kind: 'country', code: 'MA' },
    ],
    hybrid: [],
    onsite: [],
  },
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'fr', level: 'native' },
  ],
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: ['employee', 'contractor'],
  seniorities: ['senior'],
  noticePeriodDays: 30,
});

// The engine generates ids (the tables have no id default), so fixtures bring their own.
async function insertOne(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  const { error } = await admin()
    .from(table)
    .insert({ id, ...row });
  if (error)
    throw new Error(`Could not insert into ${table}: ${error.message}`);
  return id;
}

export const seedProfile = (
  userId: string,
  overrides: Record<string, unknown> = {},
) => insertOne('profiles', { ...profileFields(), userId, ...overrides });

export const seedSkill = (userId: string, profileId: string) =>
  insertOne('profile_skills', {
    userId,
    profileId,
    technology: 'typescript',
    domain: 'backend',
    mastery: 8,
  });

/** Removes userId's setup draft, if any. */
export async function clearSetupDraft(userId: string): Promise<void> {
  const { error } = await admin()
    .from('profile_setup_drafts')
    .delete()
    .eq('userId', userId);
  if (error)
    throw new Error(`Could not clear the setup draft: ${error.message}`);
}

/** A setup draft for userId; userId is unique, so any existing draft is removed first. */
export async function seedSetupDraft(
  userId: string,
  answers: Record<string, unknown> = { version: 1 },
): Promise<string> {
  await clearSetupDraft(userId);
  return insertOne('profile_setup_drafts', { userId, answers });
}

export const seedContact = (userId: string) =>
  insertOne('contacts', {
    userId,
    kind: 'email',
    value: `${randomUUID()}@xjobs.test`,
  });

export const seedWorkAuthorization = (
  userId: string,
  kind: string,
  place: string,
) => insertOne('work_authorizations', { userId, kind, place });

/** A fresh key in the agreed layout: <userId>/<profileId>/<uuid>.pdf. */
export const resumeKeyFor = (userId: string, profileId: string): string =>
  `${userId}/${profileId}/${randomUUID()}.pdf`;

/** PDF-looking bytes: the header, padded with spaces to `size`. */
export function pdfBytes(size = 1024): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  return bytes;
}

/** Publishes a draft through the service role, the way the engine does. */
export async function publishProfile(profileId: string): Promise<void> {
  const { error } = await admin()
    .from('profiles')
    .update({ state: 'published', publishedAt: new Date().toISOString() })
    .eq('id', profileId);
  if (error)
    throw new Error(`Could not publish ${profileId}: ${error.message}`);
}

/** A published profile, a processed job with its extraction, and the engine's match row. */
export async function seedJobMatch(userId: string): Promise<string> {
  const profileId = await seedProfile(userId);
  await publishProfile(profileId);
  const now = new Date().toISOString();
  const jobId = await insertOne('normalized_jobs', {
    jobKey: `test:${randomUUID()}`,
    kind: 'job',
    status: 'active',
    postingUrl: 'https://example.test/job',
    closed: false,
    fieldSources: {},
    firstSeenAt: now,
    lastSeenAt: now,
    normalizerVersion: 1,
  });
  const extractionId = await insertOne('job_extractions', {
    jobId,
    inputHash: 'test',
    schemaVersion: 1,
    promptHash: 'test',
    decisionModel: 'test',
    extractionModel: 'test',
    data: {},
    needsReview: false,
    worldwide: false,
    regionCodes: [],
    countryCodes: [],
    cityIds: [],
    techTags: [],
    mainStackTags: [],
    costUsd: 0,
  });
  return insertOne('job_matches', {
    userId,
    profileId,
    jobId,
    extractionId,
    matcherVersion: 1,
    outcome: 'qualified',
    unverified: false,
    checks: {},
    decidedAt: now,
  });
}

type Channel =
  | 'LINKEDIN_JOB_BOARD'
  | 'LINKEDIN_POSTS'
  | 'GREEN_HOUSE'
  | 'ASHBY';
export type SeededJob = { jobId: string; extractionId: string };

// Every row the detailed-job seeders create, in creation order; cleanup deletes in reverse.
const detailedRows: Array<[table: string, id: string, idColumn: string]> = [];

async function insertTracked(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const id = await insertOne(table, row);
  detailedRows.push([table, id, 'id']);
  return id;
}

const FACT_FIELDS = [
  'position',
  'isSoftwareEngineeringRole',
  'seniority',
  'yearsRequired',
  'contractType',
  'engagement',
  'contractMonths',
  'requiredLanguages',
  'workAuthorization',
  'techStack',
  'arrangement',
  'salary',
];

type FactSource = 'description' | 'linkedin';

/**
 * The job_facts document for an extraction document: the same facts, each sourced from the
 * description (`sources` overrides a field's source), openings sourced per part too
 * (`openingSources` overrides them).
 */
export function factsDocumentFor(
  document: Record<string, unknown>,
  sources: Record<string, FactSource> = {},
  openingSources: { arrangement?: FactSource; places?: FactSource } = {},
): Record<string, unknown> {
  const doc: Record<string, unknown> = { version: 1, closed: false };
  for (const f of FACT_FIELDS)
    doc[f] = {
      ...(document[f] as Record<string, unknown>),
      source: sources[f] ?? 'description',
    };
  doc.openings = (document.openings as Record<string, unknown>[]).map((o) => ({
    ...o,
    arrangementSource: openingSources.arrangement ?? 'description',
    placesSource: openingSources.places ?? 'description',
  }));
  return doc;
}

/** The job's job_facts row (one per job; removed with the job's other rows). */
export async function seedJobFacts(
  job: SeededJob,
  facts: Record<string, unknown>,
  closed = false,
): Promise<void> {
  const { error } = await admin().from('job_facts').insert({
    jobId: job.jobId,
    extractionId: job.extractionId,
    factsVersion: 1,
    factsHash: 'test',
    facts,
    closed,
    builtAt: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not insert job_facts: ${error.message}`);
  detailedRows.push(['job_facts', job.jobId, 'jobId']);
}

/** A conflict between the listing and the description on a job's field. */
export async function seedFactConflict(
  job: SeededJob,
  conflict: {
    field: string;
    listingValue: unknown;
    descriptionValue: unknown;
    winner: 'description' | 'listing';
  },
): Promise<void> {
  await insertTracked('job_fact_conflicts', {
    jobId: job.jobId,
    extractionId: job.extractionId,
    quote: 'Quote',
    ...conflict,
  });
}

/**
 * A valid v2 extraction document. String-typed hidden values carry `secret-`, and no exposed
 * one does. Enum and number internals (confidence, decidedBy, score, verdict, ...) can't carry
 * it; the facts deep-equal in match-details.db.spec.ts guards those.
 */
export function detailedDocument(): Record<string, unknown> {
  const envelope = {
    confidence: 'sure',
    decidedBy: 'generator',
    score: 0.9,
    model: 'secret-model',
    verification: {
      verdict: 'confirmed',
      score: 0.9,
      jevPick: 'secret-pick',
      rounds: 1,
    },
  };
  const fact = (value: unknown, quote: string) => ({
    value,
    quote,
    ...envelope,
  });
  const requirement = {
    importance: 8,
    domain: 'backend',
    years: null,
    confidence: 'sure',
  };
  return {
    position: fact(
      { roleKind: 'backend_engineer', title: 'Senior Backend Engineer' },
      'We are hiring a Senior Backend Engineer',
    ),
    isSoftwareEngineeringRole: fact(true, ''),
    seniority: fact('senior', 'Senior'),
    yearsRequired: fact({ min: 5, max: null }, '5+ years'),
    arrangement: fact('remote', 'Remote'),
    openings: [
      {
        arrangements: ['remote'],
        places: [
          { kind: 'region', code: 'EMEA' },
          { kind: 'country', code: 'ZZ' },
        ],
        placeStrictness: 'limit',
        timezones: [{ fromUtc: -1, toUtc: 3, label: 'CET ±2h' }],
        quote: 'Remote within EMEA',
        confidence: 'sure',
        decidedBy: 'generator',
      },
    ],
    contractType: fact('full_time', 'Full-time'),
    engagement: fact(null, ''),
    contractMonths: fact(null, ''),
    salary: fact(
      { min: 70000, max: 90000, currency: 'EUR', period: 'year' },
      '€70–90k',
    ),
    techStack: fact(
      {
        requirements: [
          {
            ...requirement,
            technology: { code: 'typescript', text: 'TypeScript' },
            kind: 'main',
            quote: 'TypeScript',
            group: null,
          },
          {
            ...requirement,
            technology: { code: null, text: 'Dynatrace' },
            kind: 'must',
            importance: 6,
            quote: 'Dynatrace',
            group: 'g1',
          },
          {
            ...requirement,
            technology: { code: null, text: 'Datadog' },
            kind: 'must',
            importance: 6,
            quote: 'Datadog',
            group: 'g1',
          },
        ],
        groups: [{ id: 'g1', min: 1 }],
      },
      'TypeScript, Dynatrace',
    ),
    requiredLanguages: fact(
      [{ lang: 'de', level: 'fluent', quote: 'Fluent German' }],
      'Fluent German',
    ),
    workAuthorization: fact(
      {
        requirements: [{ kind: 'work-permit', place: 'DE' }],
        sponsorship: 'no',
      },
      'Work permit required',
    ),
    junkFlags: fact([{ code: 'secret-junk', quote: 'secret-junk-quote' }], ''),
    conflicts: [
      {
        field: 'secret-field',
        ingestValue: 'secret-ingest',
        extractedValue: 'secret-extracted',
      },
    ],
    unmatched: [
      { list: 'techTags', text: 'secret-unmatched', at: 'secret-at' },
    ],
    truncated: false,
    verification: {
      rounds: 1,
      regenerationInvalid: false,
      dropped: [
        {
          field: 'secret-dropped',
          generatorValue: 'secret-generator-value',
          jevPick: 'secret-jev',
        },
      ],
      missedJunkFlags: ['secret-missed'],
    },
    models: { verifier: 'secret-verifier', generator: 'secret-generator' },
  };
}

/** One channel's source chain for a job, down to the `normalized_job_sources` link. */
async function seedSourceChain(
  jobId: string,
  jobKey: string,
  channel: Channel,
  now: string,
): Promise<void> {
  const queryId = await insertTracked('query_search_builder', {
    channel,
    location: 'remote',
    experience: 'senior',
    technologies: [],
    domain: 'backend',
    type: 'remote',
    keyword: 'engineer',
    version: 1,
    params: {},
    hash: randomUUID(),
  });
  const segmentRunId = await insertTracked('search_segment_runs', {
    channel,
    segmentKey: 'backend|remote|remote',
    segmentHash: randomUUID(),
    queryIds: [queryId],
    windowStart: '2026-11-02T00:00:00Z',
    windowEnd: now,
    startedAt: now,
    finishedAt: now,
    status: 'succeeded',
    fetched: 1,
    capped: false,
    truncatedQueryIds: [],
    perQuery: {},
  });
  const batchId = await insertTracked('collection_batches', {
    channel,
    segmentRunId,
    storageKey: `batches/${randomUUID()}.json`,
    formatVersion: 1,
    observedAt: now,
    itemCount: 1,
    actor: 'test',
    status: 'pending',
  });
  const rawItemId = await insertTracked('raw_items', {
    channel,
    sourceKey: randomUUID(),
    kind: 'job',
    firstSeenAt: now,
    lastSeenAt: now,
  });
  const rawVersionId = await insertTracked('raw_item_versions', {
    rawItemId,
    contentHash: randomUUID(),
    payload: {},
    firstBatchId: batchId,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  const normalizedVersionId = await insertTracked('normalized_versions', {
    rawVersionId,
    normalizerVersion: 1,
    status: 'valid',
    record: {},
    jobKey,
  });
  await insertTracked('normalized_job_sources', {
    jobId,
    rawItemId,
    normalizedVersionId,
    linkedAt: now,
  });
}

async function insertDetailedJob(
  status: 'active' | 'merged',
  mergedIntoId: string | null,
  jobKey: string,
  postedAt: string | null = null,
): Promise<string> {
  const now = new Date().toISOString();
  return insertTracked('normalized_jobs', {
    jobKey,
    postedAt,
    kind: 'job',
    status,
    mergedIntoId,
    title: 'Senior Backend Engineer',
    companyName: 'Acme',
    companyUrl: 'https://acme.example/about',
    location: 'Remote, EMEA',
    contractType: 'full_time',
    experienceLevel: 'senior',
    sector: 'Software',
    salaryText: '€70–90k',
    salaryMin: 70000,
    salaryMax: 90000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    publishedAt: '2026-11-01',
    descriptionHtml: '<p>secret-html</p>',
    descriptionText: 'Build backend services.',
    applyUrl: 'https://acme.example/apply',
    postingUrl: 'https://acme.example/job',
    posterName: 'Pat Poster',
    posterProfileUrl: 'https://linkedin.example/in/pat',
    posterType: 'recruiter',
    closed: false,
    fieldSources: { title: 'secret-source' },
    firstSeenAt: now,
    lastSeenAt: now,
    processingStatus: 'processed',
    processingError: 'secret-error',
    normalizerVersion: 1,
  });
}

/**
 * A fully populated job with a v2 extraction and one source chain per channel. Hidden
 * fields carry `secret-` values. `merged` also creates the job it was merged into.
 */
export async function seedDetailedJob(
  opts: {
    status?: 'active' | 'merged';
    channels?: Channel[];
    lastSeenAt?: string;
    postedAt?: string | null;
    document?: Record<string, unknown>;
    /** Skip the job_facts row (a job still on a v2 extraction). */
    noFacts?: boolean;
    /** Per-field sources for the job_facts row; the rest come from the description. */
    sources?: Record<string, FactSource>;
    /** Per-part sources of the job_facts openings; both default to the description. */
    openingSources?: { arrangement?: FactSource; places?: FactSource };
    /** job_facts.closed (an expired LinkedIn listing); normalized_jobs.closed stays false. */
    factsClosed?: boolean;
    /** normalized_jobs.expiresAt. */
    expiresAt?: string;
  } = {},
): Promise<SeededJob> {
  const status = opts.status ?? 'active';
  const jobKey = `test:${randomUUID()}`;
  const targetId =
    status === 'merged'
      ? await insertDetailedJob('active', null, `test:${randomUUID()}`)
      : null;
  const jobId = await insertDetailedJob(
    status,
    targetId,
    jobKey,
    opts.postedAt ?? null,
  );
  if (opts.lastSeenAt) {
    // firstSeenAt moves too: a job is never last seen before it was first seen.
    const { error } = await admin()
      .from('normalized_jobs')
      .update({ firstSeenAt: opts.lastSeenAt, lastSeenAt: opts.lastSeenAt })
      .eq('id', jobId);
    if (error) throw new Error(`Could not set lastSeenAt: ${error.message}`);
  }
  if (opts.expiresAt) {
    const { error } = await admin()
      .from('normalized_jobs')
      .update({ expiresAt: opts.expiresAt })
      .eq('id', jobId);
    if (error) throw new Error(`Could not set expiresAt: ${error.message}`);
  }
  const extractionId = await insertTracked('job_extractions', {
    jobId,
    inputHash: 'test',
    schemaVersion: 2,
    promptHash: 'secret-prompt',
    decisionModel: 'secret-decision',
    extractionModel: 'secret-extraction',
    data: opts.document ?? detailedDocument(),
    needsReview: false,
    arrangement: 'remote',
    seniority: 'senior',
    roleKind: 'backend_engineer',
    contractType: 'full_time',
    isSoftwareEngineeringRole: true,
    worldwide: false,
    regionCodes: ['EMEA'],
    countryCodes: [],
    cityIds: [],
    techTags: ['typescript'],
    mainStackTags: ['typescript'],
    costUsd: 0.01,
  });
  const now = new Date().toISOString();
  for (const channel of opts.channels ?? ['LINKEDIN_JOB_BOARD'])
    await seedSourceChain(jobId, jobKey, channel, now);
  const seeded = { jobId, extractionId };
  if (!opts.noFacts)
    await seedJobFacts(
      seeded,
      factsDocumentFor(
        opts.document ?? detailedDocument(),
        opts.sources,
        opts.openingSources,
      ),
      opts.factsClosed ?? false,
    );
  return seeded;
}

/** A newer v2 extraction on an existing job, with its own `seniority` column; returns it as a SeededJob. */
export async function addExtraction(
  jobId: string,
  document: Record<string, unknown>,
  seniority: string,
): Promise<SeededJob> {
  const extractionId = await insertTracked('job_extractions', {
    jobId,
    inputHash: 'test-newer',
    schemaVersion: 2,
    promptHash: 'secret-prompt',
    decisionModel: 'secret-decision',
    extractionModel: 'secret-extraction',
    data: document,
    needsReview: false,
    arrangement: 'remote',
    seniority,
    roleKind: 'backend_engineer',
    contractType: 'full_time',
    isSoftwareEngineeringRole: true,
    worldwide: false,
    regionCodes: ['EMEA'],
    countryCodes: [],
    cityIds: [],
    techTags: ['typescript'],
    mainStackTags: ['typescript'],
    costUsd: 0.01,
  });
  const { error } = await admin()
    .from('normalized_jobs')
    .update({ currentExtractionId: extractionId })
    .eq('id', jobId);
  if (error)
    throw new Error(`Could not set currentExtractionId: ${error.message}`);
  return { jobId, extractionId };
}

/** The engine's match row for userId's profile on a seeded job; returns the match id. */
export const seedMatchOn = (
  userId: string,
  profileId: string,
  job: SeededJob,
  opts: {
    outcome?: 'qualified' | 'rejected' | 'review';
    /** With outcome `review`: the rule and field that sent it there. */
    review?: { rule: string; field: string };
    checks?: unknown;
    stackScore?: number;
  } = {},
): Promise<string> =>
  insertTracked('job_matches', {
    userId,
    profileId,
    jobId: job.jobId,
    extractionId: job.extractionId,
    matcherVersion: 1,
    outcome: opts.outcome ?? 'qualified',
    reviewRule: opts.review?.rule ?? null,
    reviewField: opts.review?.field ?? null,
    unverified: false,
    stackScore: opts.stackScore ?? null,
    checks: opts.checks ?? {},
    decidedAt: new Date().toISOString(),
  });

/** Deletes everything seedDetailedJob and seedMatchOn created, children first. */
export async function cleanupDetailedJobs(): Promise<void> {
  while (detailedRows.length > 0) {
    const [table, id, idColumn] = detailedRows.pop()!;
    const { error } = await admin().from(table).delete().eq(idColumn, id);
    if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
  }
}
