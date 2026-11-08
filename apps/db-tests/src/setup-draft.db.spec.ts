import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  profileFields,
  publishProfile,
  seedProfile,
  seedSetupDraft,
  seedSkill,
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

/** The stack as a sorted list, without ids and timestamps. */
const stackOf = async (profileId: string): Promise<Skill[]> =>
  (await adminSelect('profile_skills', 'profileId', profileId))
    .map((r) => ({
      technology: r['technology'] as string,
      domain: r['domain'] as string,
      mastery: r['mastery'] as number,
      importance: r['importance'] as number,
    }))
    .sort((x, y) => x.technology.localeCompare(y.technology));

const create = (
  user: TestUser,
  profile: Record<string, unknown>,
  skills: Skill[],
) =>
  user.client.rpc('create_profile_from_setup', {
    p_profile: profile,
    p_skills: skills,
  });

const replace = (user: TestUser, profileId: string, skills: Skill[]) =>
  user.client.rpc('replace_profile_skills', {
    p_profile_id: profileId,
    p_skills: skills,
  });

describe('create_profile_from_setup', () => {
  let a: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
  });

  it('create_profile_from_setup creates the profile and skills and deletes the draft', async () => {
    await seedSetupDraft(a.id);
    const { data, error } = await create(a, profileFields(), twoSkills);
    expect(error).toBeNull();
    expect(typeof data).toBe('string');

    const profiles = await profilesOf(a.id);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: data,
      userId: a.id,
      state: 'draft',
      position: 'backend_engineer',
      contractTypes: ['full_time'],
      noticePeriodDays: 30,
    });
    const skills = await skillsOf(a.id);
    expect(skills).toHaveLength(2);
    expect(skills.every((s) => s['profileId'] === data)).toBe(true);
    expect(await stackOf(data as string)).toEqual(
      [...twoSkills].sort((x, y) => x.technology.localeCompare(y.technology)),
    );
    expect(await draftOf(a.id)).toEqual([]);
  });

  it('second call after success raises P0002 and creates nothing', async () => {
    const { data, error } = await create(a, profileFields(), twoSkills);
    expect(error?.code).toBe('P0002');
    expect(data).toBeNull();
    expect(await profilesOf(a.id)).toHaveLength(1);
    expect(await skillsOf(a.id)).toHaveLength(2);
  });

  it('invalid profile leaves the draft and writes nothing', async () => {
    const c = await createTestUser();
    await seedSetupDraft(c.id, { version: 1, terms: { notice: 30 } });
    const { error } = await create(
      c,
      { ...profileFields(), contractTypes: ['unknown'] },
      twoSkills,
    );
    expect(error).not.toBeNull();
    expect(error?.message).toContain('profiles.contractTypes');
    expect(await profilesOf(c.id)).toEqual([]);
    expect(await skillsOf(c.id)).toEqual([]);
    const draft = await draftOf(c.id);
    expect(draft).toHaveLength(1);
    expect(draft[0]?.['answers']).toEqual({
      version: 1,
      terms: { notice: 30 },
    });
  });

  it("cannot use another user's draft", async () => {
    const d = await createTestUser();
    const e = await createTestUser();
    await seedSetupDraft(e.id);
    const before = await draftOf(e.id);

    const { error } = await create(d, profileFields(), twoSkills);
    expect(error?.code).toBe('P0002');
    expect(await draftOf(e.id)).toEqual(before);
    expect(await profilesOf(d.id)).toEqual([]);
    expect(await profilesOf(e.id)).toEqual([]);
  });
});

describe('replace_profile_skills', () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  const newStack: Skill[] = [
    { technology: 'go', domain: 'devops', mastery: 6, importance: 5 },
    { technology: 'python', domain: 'data', mastery: 3, importance: 10 },
  ];

  it('replace_profile_skills swaps the stack on a draft', async () => {
    const profileId = await seedProfile(a.id);
    await seedSkill(a.id, profileId);
    const { error } = await replace(a, profileId, newStack);
    expect(error).toBeNull();
    expect(await stackOf(profileId)).toEqual(newStack);
  });

  it('replace_profile_skills on a published profile changes nothing', async () => {
    const profileId = await seedProfile(a.id);
    await seedSkill(a.id, profileId);
    await publishProfile(profileId);
    const before = await stackOf(profileId);

    const { error } = await replace(a, profileId, newStack);
    expect(error?.code).toBe('P0002');
    expect(await stackOf(profileId)).toEqual(before);
  });

  it('replace_profile_skills with an empty list on a published profile raises P0002', async () => {
    const profileId = await seedProfile(a.id);
    await seedSkill(a.id, profileId);
    await publishProfile(profileId);
    const before = await stackOf(profileId);

    const { error } = await replace(a, profileId, []);
    expect(error?.code).toBe('P0002');
    expect(await stackOf(profileId)).toEqual(before);
  });

  it('two concurrent replace_profile_skills calls leave exactly one of the lists', async () => {
    const profileId = await seedProfile(a.id);
    await seedSkill(a.id, profileId);
    const other: Skill[] = [
      { technology: 'go', domain: 'devops', mastery: 2, importance: 1 },
      { technology: 'rust', domain: 'backend', mastery: 7, importance: 6 },
    ];

    const results = await Promise.all([
      replace(a, profileId, newStack),
      replace(a, profileId, other),
    ]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect([newStack, other]).toContainEqual(await stackOf(profileId));
  });

  it('a double submit of the same stack succeeds twice and keeps one copy', async () => {
    const profileId = await seedProfile(a.id);
    await seedSkill(a.id, profileId);

    const results = await Promise.all([
      replace(a, profileId, newStack),
      replace(a, profileId, newStack),
    ]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect(await stackOf(profileId)).toEqual(newStack);
  });

  it("replace_profile_skills on another user's profile changes nothing", async () => {
    const profileId = await seedProfile(b.id);
    await seedSkill(b.id, profileId);
    const before = await stackOf(profileId);

    const { error } = await replace(a, profileId, newStack);
    expect(error?.code).toBe('P0002');
    expect(await stackOf(profileId)).toEqual(before);
    expect(await skillsOf(a.id)).not.toContainEqual(
      expect.objectContaining({ profileId }),
    );
  });
});
