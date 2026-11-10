import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  profileFields,
  seedProfile,
  seedSetupDraft,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(cleanupTestUsers);

type Skill = {
  technology: string;
  domain: string;
  mastery: number;
  importance: number;
};

const twoSkills: Skill[] = [
  { technology: 'typescript', domain: 'backend', mastery: 8, importance: 5 },
  { technology: 'rust', domain: 'backend', mastery: 4, importance: 9 },
];

async function adminSelect(
  table: string,
  column: string,
  value: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin()
    .from(table)
    .select('*')
    .eq(column, value);
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>[];
}

const profilesOf = (userId: string) =>
  adminSelect('profiles', 'userId', userId);
const skillsOf = (userId: string) =>
  adminSelect('profile_skills', 'userId', userId);
const draftOf = (userId: string) =>
  adminSelect('profile_setup_drafts', 'userId', userId);

/** A version-2 (new-profile) draft for userId, returning its newProfileId. */
async function seedNewProfileDraft(
  userId: string,
  copyFrom: string | null = null,
): Promise<string> {
  const newProfileId = randomUUID();
  await seedSetupDraft(userId, { version: 2, newProfileId, copyFrom });
  return newProfileId;
}

const create = (
  user: TestUser,
  profileId: string,
  profile: Record<string, unknown> = profileFields(),
  skills: Skill[] = twoSkills,
) =>
  user.client.rpc('create_profile_from_draft', {
    p_profile_id: profileId,
    p_profile: profile,
    p_skills: skills,
  });

describe('create_profile_from_draft', () => {
  it('creates a second profile when the user already has one', async () => {
    const a = await createTestUser();
    const firstId = await seedProfile(a.id);
    const newId = await seedNewProfileDraft(a.id, firstId);

    const { data, error } = await create(a, newId);
    expect(error).toBeNull();
    expect(data).toBe(newId);

    const profiles = await profilesOf(a.id);
    expect(profiles.map((p) => p['id']).sort()).toEqual(
      [firstId, newId].sort(),
    );
    expect(profiles.find((p) => p['id'] === newId)).toMatchObject({
      userId: a.id,
      state: 'draft',
      position: 'backend_engineer',
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
    });
    const skills = await skillsOf(a.id);
    expect(skills).toHaveLength(2);
    expect(skills.every((s) => s['profileId'] === newId)).toBe(true);
    expect(await draftOf(a.id)).toEqual([]);
  });

  it('a repeated call returns the same profile and inserts nothing', async () => {
    const a = await createTestUser();
    await seedProfile(a.id);
    const newId = await seedNewProfileDraft(a.id);

    const first = await create(a, newId);
    const second = await create(a, newId);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data).toBe(newId);
    expect(second.data).toBe(newId);
    expect(await profilesOf(a.id)).toHaveLength(2);
    expect(await skillsOf(a.id)).toHaveLength(2);
    expect(await draftOf(a.id)).toEqual([]);
  });

  it('two concurrent calls create exactly one profile and both return its id', async () => {
    const a = await createTestUser();
    await seedProfile(a.id);
    const newId = await seedNewProfileDraft(a.id);

    const results = await Promise.all([create(a, newId), create(a, newId)]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect(results.map((r) => r.data)).toEqual([newId, newId]);
    expect(await profilesOf(a.id)).toHaveLength(2);
    expect(await skillsOf(a.id)).toHaveLength(2);
    expect(await draftOf(a.id)).toEqual([]);
  });

  it("refuses an id that isn't the draft's", async () => {
    const a = await createTestUser();
    const firstId = await seedProfile(a.id);
    await seedNewProfileDraft(a.id);
    const before = await draftOf(a.id);

    const { data, error } = await create(a, randomUUID());
    expect(error?.code).toBe('P0002');
    expect(error?.message).toBe(
      'no new-profile draft to create a profile from',
    );
    expect(data).toBeNull();
    expect((await profilesOf(a.id)).map((p) => p['id'])).toEqual([firstId]);
    expect(await skillsOf(a.id)).toEqual([]);
    expect(await draftOf(a.id)).toEqual(before);
  });

  it('refuses a setup (version 1) draft that carries the id', async () => {
    const a = await createTestUser();
    await seedProfile(a.id);
    const newId = randomUUID();
    await seedSetupDraft(a.id, { version: 1, newProfileId: newId });

    const { error } = await create(a, newId);
    expect(error?.code).toBe('P0002');
    expect(await profilesOf(a.id)).toHaveLength(1);
    expect(await draftOf(a.id)).toHaveLength(1);
  });

  it('refuses a sixth profile', async () => {
    const a = await createTestUser();
    for (let i = 0; i < 5; i++) await seedProfile(a.id);
    const newId = await seedNewProfileDraft(a.id);
    const before = await draftOf(a.id);

    const { data, error } = await create(a, newId);
    expect(error?.code).toBe('P0001');
    expect(error?.message).toBe('You can have at most 5 profiles');
    expect(data).toBeNull();
    expect(await profilesOf(a.id)).toHaveLength(5);
    expect(await skillsOf(a.id)).toEqual([]);
    expect(await draftOf(a.id)).toEqual(before);
  });

  it("can't use another user's draft", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await seedProfile(a.id);
    const newId = await seedNewProfileDraft(a.id);
    const before = await draftOf(a.id);

    const { error } = await create(b, newId);
    expect(error?.code).toBe('P0002');
    expect(await draftOf(a.id)).toEqual(before);
    expect(await profilesOf(a.id)).toHaveLength(1);
    expect(await profilesOf(b.id)).toEqual([]);
  });

  it("never returns or touches another user's profile with that id", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const aProfileId = await seedProfile(a.id);
    const aBefore = await profilesOf(a.id);
    // b forges a draft naming a's profile id.
    await seedSetupDraft(b.id, {
      version: 2,
      newProfileId: aProfileId,
      copyFrom: null,
    });

    const { data, error } = await create(b, aProfileId);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(await profilesOf(a.id)).toEqual(aBefore);
    expect(await profilesOf(b.id)).toEqual([]);
    expect(await skillsOf(b.id)).toEqual([]);
  });
});
