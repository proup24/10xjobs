import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

/**
 * The matcher re-decides a user's jobs when their eligibility changes. The web app writes
 * it straight to Supabase, so triggers bump `users.eligibilityVersion` on every change.
 */
describe('eligibility version', () => {
  let a: TestUser;

  async function version(): Promise<number> {
    const { data, error } = await a.client
      .from('users')
      .select('eligibilityVersion')
      .eq('id', a.id)
      .single();
    expect(error).toBeNull();
    return (data as { eligibilityVersion: number }).eligibilityVersion;
  }

  async function updateUser(values: Record<string, unknown>): Promise<void> {
    const { error } = await a.client
      .from('users')
      .update(values)
      .eq('id', a.id);
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    a = await createTestUser();
  });

  it('inserting, updating or deleting a work authorization bumps eligibilityVersion', async () => {
    const start = await version();
    const id = randomUUID();
    const insert = await a.client
      .from('work_authorizations')
      .insert({ id, userId: a.id, kind: 'work-permit', place: 'MA' });
    expect(insert.error).toBeNull();
    expect(await version()).toBe(start + 1);

    const update = await a.client
      .from('work_authorizations')
      .update({ place: 'FR' })
      .eq('id', id);
    expect(update.error).toBeNull();
    expect(await version()).toBe(start + 2);

    const remove = await a.client
      .from('work_authorizations')
      .delete()
      .eq('id', id);
    expect(remove.error).toBeNull();
    expect(await version()).toBe(start + 3);
  });

  it('a user updates name, residenceCountry and acceptsSponsorship, never eligibilityVersion', async () => {
    await updateUser({
      name: 'Grant Test',
      residenceCountry: 'ES',
      acceptsSponsorship: false,
    });
    const start = await version();
    const denied = await a.client
      .from('users')
      .update({ eligibilityVersion: start - 1 })
      .eq('id', a.id);
    expect(denied.error?.code).toBe('42501');
    expect(await version()).toBe(start);
  });

  it('changing residenceCountry bumps it', async () => {
    const start = await version();
    await updateUser({ residenceCountry: 'MA' });
    expect(await version()).toBe(start + 1);
    await updateUser({ residenceCountry: 'FR' });
    expect(await version()).toBe(start + 2);
  });

  it('changing acceptsSponsorship bumps it', async () => {
    const start = await version();
    await updateUser({ acceptsSponsorship: true });
    expect(await version()).toBe(start + 1);
  });

  it('setting residenceCountry or acceptsSponsorship to the same value does not', async () => {
    await updateUser({ residenceCountry: 'DE', acceptsSponsorship: false });
    const start = await version();
    await updateUser({ residenceCountry: 'DE', acceptsSponsorship: false });
    expect(await version()).toBe(start);
  });

  it('changing another users column does not', async () => {
    const start = await version();
    await updateUser({ name: `Someone ${randomUUID()}` });
    expect(await version()).toBe(start);
  });
});
