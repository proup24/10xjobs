import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  cleanupTestUsers,
  createTestUser,
  inviteTestUser,
} from './support/test-users.js';

afterAll(cleanupTestUsers);

const draftProfile = (userId: string) => ({
  userId,
  position: 'backend_engineer',
  contractTypes: ['full_time'],
  locations: {
    remote: [{ kind: 'region', code: 'EMEA' }],
    hybrid: [],
    onsite: [],
  },
  languages: [{ lang: 'en', level: 'fluent' }],
  yearsOfExperience: 5,
  timezoneCurrent: 60,
  timezoneMin: 0,
  timezoneMax: 120,
  engagements: ['employee'],
  seniorities: ['senior'],
  noticePeriodDays: 30,
});

// The engine generates ids (the tables have no id default), so fixtures bring their own.
async function insertOne(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin()
    .from(table)
    .insert({ id: randomUUID(), ...row })
    .select('id')
    .single();
  if (error)
    throw new Error(`Could not insert into ${table}: ${error.message}`);
  return (data as { id: string }).id;
}

async function countWhere(
  table: string,
  column: string,
  value: string,
): Promise<number | null> {
  const { count, error } = await admin()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count;
}

describe('accounts', () => {
  it('a new auth user gets exactly one users row with a null name', async () => {
    const a = await createTestUser();
    const { data } = await admin()
      .from('users')
      .select('id, name')
      .eq('id', a.id);
    expect(data).toEqual([{ id: a.id, name: null }]);
  });

  it('an invited user gets exactly one users row', async () => {
    const { id } = await inviteTestUser();
    const { data } = await admin().from('users').select('id').eq('id', id);
    expect(data).toHaveLength(1);
  });

  it('deleting the auth user removes their users row and everything they own', async () => {
    const a = await createTestUser();
    await insertOne('contacts', {
      userId: a.id,
      kind: 'email',
      value: a.email,
    });
    const profileId = await insertOne('profiles', draftProfile(a.id));
    await insertOne('profile_skills', {
      userId: a.id,
      profileId,
      technology: 'typescript',
      domain: 'backend',
      mastery: 8,
    });

    const { error } = await admin().auth.admin.deleteUser(a.id);
    expect(error).toBeNull();

    expect(await countWhere('users', 'id', a.id)).toBe(0);
    expect(await countWhere('contacts', 'userId', a.id)).toBe(0);
    expect(await countWhere('profiles', 'userId', a.id)).toBe(0);
    expect(await countWhere('profile_skills', 'userId', a.id)).toBe(0);
    expect(await countWhere('profile_skills', 'profileId', profileId)).toBe(0);
  });

  it('a user cannot insert a second users row or delete their own', async () => {
    const a = await createTestUser();
    const stray = randomUUID();
    const inserted = await a.client.from('users').insert({ id: stray });
    expect(inserted.error?.code).toBe('42501');
    expect(await countWhere('users', 'id', stray)).toBe(0);

    await a.client.from('users').delete().eq('id', a.id);
    expect(await countWhere('users', 'id', a.id)).toBe(1);
  });

  it('users has no email column', async () => {
    const { error } = await admin().from('users').select('email').limit(1);
    expect(error?.code).toBe('42703');
  });
});
