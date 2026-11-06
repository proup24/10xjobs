import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

function expectCheckViolation(error: PostgrestError | null, field: string) {
  expect(error?.code).toBe(CHECK_VIOLATION);
  expect(error?.message).toContain(field);
}

describe('eligibility', () => {
  let a: TestUser;

  const insertAuthorization = (kind: string, place: string) =>
    a.client
      .from('work_authorizations')
      .insert({ id: randomUUID(), userId: a.id, kind, place });

  beforeAll(async () => {
    a = await createTestUser();
  });

  it('allows none: a user with no authorizations reads an empty list', async () => {
    const { data, error } = await a.client
      .from('work_authorizations')
      .select('kind, place');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('stores and reads eligibility', async () => {
    const update = await a.client
      .from('users')
      .update({ residenceCountry: 'MA', acceptsSponsorship: true })
      .eq('id', a.id);
    expect(update.error).toBeNull();

    expect((await insertAuthorization('work-permit', 'MA')).error).toBeNull();
    expect((await insertAuthorization('work-permit', 'EU')).error).toBeNull();

    const user = await a.client
      .from('users')
      .select('residenceCountry, acceptsSponsorship')
      .eq('id', a.id)
      .single();
    expect(user.data).toEqual({
      residenceCountry: 'MA',
      acceptsSponsorship: true,
    });

    const { data, error } = await a.client
      .from('work_authorizations')
      .select('kind, place')
      .order('place');
    expect(error).toBeNull();
    expect(data).toEqual([
      { kind: 'work-permit', place: 'EU' },
      { kind: 'work-permit', place: 'MA' },
    ]);
  });

  it('refuses a bad residence country', async () => {
    const { error } = await a.client
      .from('users')
      .update({ residenceCountry: 'ZZ' })
      .eq('id', a.id);
    expectCheckViolation(error, 'users.residenceCountry');
  });

  it('refuses a bad kind', async () => {
    const { error } = await insertAuthorization('visa', 'MA');
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it.each(['ZZ', 'GLOBAL'])('refuses the place %s', async (place) => {
    const { error } = await insertAuthorization('residency', place);
    expectCheckViolation(error, 'work_authorizations.place');
    expect(error?.message).toBe(
      `work_authorizations.place: '${place}' is not an approved countries or regions code`,
    );
  });

  it('refuses a duplicate pair', async () => {
    expect((await insertAuthorization('clearance', 'MA')).error).toBeNull();
    const { error } = await insertAuthorization('clearance', 'MA');
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it('moves a work authorization to an unapproved place only through the check', async () => {
    const { error } = await a.client
      .from('work_authorizations')
      .update({ place: 'ZZ' })
      .eq('kind', 'clearance');
    expectCheckViolation(error, 'work_authorizations.place');
  });
});
