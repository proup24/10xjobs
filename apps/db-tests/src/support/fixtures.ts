import { randomUUID } from 'node:crypto';
import { admin } from './admin.js';

/** Valid required `profiles` fields; the owner is added by the caller. */
export const profileFields = () => ({
  position: 'backend_engineer',
  languages: ['EN', 'FR'],
  country: 'MA',
  city: 'Rabat',
  locations: {
    remote: ['MENA', 'North Africa', 'EMEA'],
    hybrid: [],
    onsite: [],
  },
  contractTypes: ['full_time'],
  places: {
    remote: [
      { kind: 'region', code: 'MENA' },
      { kind: 'country', code: 'MA' },
    ],
    hybrid: [],
    onsite: [],
  },
  spokenLanguages: [
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
