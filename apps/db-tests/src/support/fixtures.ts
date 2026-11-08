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
