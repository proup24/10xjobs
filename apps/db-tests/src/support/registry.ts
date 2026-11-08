import { randomUUID } from 'node:crypto';
import { admin } from './admin.js';
import {
  clearSetupDraft,
  profileFields,
  seedContact,
  seedProfile,
  seedSetupDraft,
  seedSkill,
  seedWorkAuthorization,
} from './fixtures.js';

const usedCountries = new Set<string>(['MA']);
async function freshCountry(): Promise<string> {
  const { data, error } = await admin()
    .from('countries')
    .select('code')
    .eq('status', 'approved')
    .order('code');
  if (error) throw new Error(error.message);
  const code = data
    .map((c) => c.code as string)
    .find((c) => !usedCountries.has(c));
  if (!code) throw new Error('No approved country left to seed');
  usedCountries.add(code);
  return code;
}

export type OwnedTable = {
  table: string;
  ownerColumn: 'userId' | 'id';
  /** Service role creates a row owned by userId and returns its id. */
  seed(userId: string): Promise<string>;
  /** A valid insert payload for userId, or null if users can't insert. */
  insertPayload: ((userId: string) => Promise<Record<string, unknown>>) | null;
  /** A harmless update the owner is allowed to make. */
  patch: Record<string, unknown>;
  /** The owner may delete their own row. The cross-user delete case runs for every table regardless. */
  canDelete: boolean;
};

/** Every table with an owner. Adding one here puts it under the isolation suite. */
export const ownedTables: OwnedTable[] = [
  {
    table: 'users',
    ownerColumn: 'id',
    // The sign-up trigger already created the row.
    seed: async (userId) => userId,
    insertPayload: null,
    patch: {
      name: 'Renamed',
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    },
    canDelete: false,
  },
  {
    table: 'contacts',
    ownerColumn: 'userId',
    seed: seedContact,
    insertPayload: async (userId) => ({
      id: randomUUID(),
      userId,
      kind: 'email',
      value: `${randomUUID()}@xjobs.test`,
    }),
    patch: { label: 'work' },
    canDelete: true,
  },
  {
    table: 'profiles',
    ownerColumn: 'userId',
    seed: seedProfile,
    insertPayload: async (userId) => ({
      id: randomUUID(),
      userId,
      ...profileFields(),
    }),
    patch: { noticePeriodDays: 60, contractTypes: ['full_time', 'part_time'] },
    canDelete: true,
  },
  {
    table: 'profile_skills',
    ownerColumn: 'userId',
    seed: async (userId) => seedSkill(userId, await seedProfile(userId)),
    insertPayload: async (userId) => ({
      id: randomUUID(),
      userId,
      profileId: await seedProfile(userId),
      technology: 'rust',
      domain: 'backend',
      mastery: 5,
    }),
    patch: { mastery: 6 },
    canDelete: true,
  },
  {
    table: 'work_authorizations',
    ownerColumn: 'userId',
    // (userId, kind, place) is unique and the suite seeds the same user more than once,
    // so every seed takes a fresh approved country (never MA, which insertPayload uses).
    seed: async (userId) =>
      seedWorkAuthorization(userId, 'work-permit', await freshCountry()),
    insertPayload: async (userId) => ({
      id: randomUUID(),
      userId,
      kind: 'citizenship',
      place: 'MA',
    }),
    patch: { kind: 'residency' },
    canDelete: true,
  },
  {
    table: 'profile_setup_drafts',
    ownerColumn: 'userId',
    // userId is unique: seedSetupDraft replaces the user's draft, so the suite can seed
    // twice, and insertPayload clears it, so the owner's insert follows a seed.
    seed: (userId) => seedSetupDraft(userId),
    insertPayload: async (userId) => {
      await clearSetupDraft(userId);
      return { id: randomUUID(), userId, answers: { version: 1 } };
    },
    patch: { answers: { version: 1, job: null } },
    canDelete: true,
  },
];
