import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { publishProfile, seedProfile, seedSkill } from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

// Postgres' insufficient_privilege: a column grant refused the write.
const PRIVILEGE = '42501';
const PAST = '2020-01-01T00:00:00.000Z';

describe('search switches', () => {
  let user: TestUser;

  const profile = async (id: string) => {
    const { data, error } = await admin()
      .from('profiles')
      .select('matchVersion, indeedSearch, postSearch')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as {
      matchVersion: number;
      indeedSearch: boolean;
      postSearch: boolean;
    };
  };
  const resumedAt = async (): Promise<Date | null> => {
    const { data, error } = await admin()
      .from('users')
      .select('searchesResumedAt')
      .eq('id', user.id)
      .single();
    if (error) throw new Error(error.message);
    const value = (data as { searchesResumedAt: string | null })
      .searchesResumedAt;
    return value === null ? null : new Date(value);
  };
  const setPast = async () => {
    const { error } = await admin()
      .from('users')
      .update({ searchesResumedAt: PAST })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  };
  const published = async () => {
    const id = await seedProfile(user.id);
    await seedSkill(user.id, id);
    await publishProfile(id);
    await setPast();
    return id;
  };

  beforeAll(async () => {
    user = await createTestUser();
  });

  it('indeedSearch defaults to false', async () => {
    const id = await seedProfile(user.id);
    expect((await profile(id)).indeedSearch).toBe(false);
  });

  it.each(['indeedSearch', 'postSearch'] as const)(
    'switching %s on a published profile bumps nothing',
    async (column) => {
      const id = await published();
      const before = await profile(id);
      const { error } = await admin()
        .from('profiles')
        .update({ [column]: true })
        .eq('id', id);
      expect(error).toBeNull();
      const after = await profile(id);
      expect(after[column]).toBe(true);
      expect(after.matchVersion).toBe(before.matchVersion);
      expect((await resumedAt())?.toISOString()).toBe(PAST);
    },
  );

  it('the prefilter recording its recheck bumps nothing', async () => {
    const id = await published();
    const before = await profile(id);
    const { error } = await admin()
      .from('profiles')
      .update({ prefilterCheckedVersion: before.matchVersion })
      .eq('id', id);
    expect(error).toBeNull();
    expect((await profile(id)).matchVersion).toBe(before.matchVersion);
    expect((await resumedAt())?.toISOString()).toBe(PAST);
  });

  it('a preference edit still bumps', async () => {
    const id = await published();
    const before = await profile(id);
    const { error } = await user.client
      .from('profiles')
      .update({ yearsOfExperience: 13 })
      .eq('id', id);
    expect(error).toBeNull();
    expect((await profile(id)).matchVersion).toBe(before.matchVersion + 1);
    const at = await resumedAt();
    expect(Math.abs(Date.now() - (at as Date).getTime())).toBeLessThan(5000);
  });

  it('owner cannot write indeedSearch', async () => {
    const id = await published();
    const { error } = await user.client
      .from('profiles')
      .update({ indeedSearch: true })
      .eq('id', id);
    expect(error?.code).toBe(PRIVILEGE);
  });
});
