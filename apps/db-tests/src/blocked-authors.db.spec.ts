import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

// Postgres' unique_violation and check_violation.
const UNIQUE = '23505';
const CHECK = '23514';

describe('blocked_authors', () => {
  let a: TestUser;
  let b: TestUser;
  const key = `profile:jane-${randomUUID()}`;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  it('an owner inserts and reads back their own block', async () => {
    const { error } = await a.client.from('blocked_authors').insert({
      id: randomUUID(),
      userId: a.id,
      authorKey: key,
      name: 'Jane',
      profileUrl: 'https://www.linkedin.com/in/jane',
    });
    expect(error).toBeNull();
    const { data } = await a.client
      .from('blocked_authors')
      .select('authorKey, name, profileUrl')
      .eq('userId', a.id);
    expect(data).toEqual([
      {
        authorKey: key,
        name: 'Jane',
        profileUrl: 'https://www.linkedin.com/in/jane',
      },
    ]);
  });

  it("another user sees none of the owner's rows", async () => {
    const { data, error } = await b.client.from('blocked_authors').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('another user cannot insert a row for the owner', async () => {
    const { error } = await b.client
      .from('blocked_authors')
      .insert({ id: randomUUID(), userId: a.id, authorKey: 'profile:other' });
    expect(error?.code).toBe('42501');
  });

  it('nobody updates a row', async () => {
    const { data } = await a.client
      .from('blocked_authors')
      .update({ name: 'Changed' })
      .eq('authorKey', key)
      .select();
    expect(data ?? []).toEqual([]);
  });

  it('a second insert of the same key fails', async () => {
    const { error } = await a.client
      .from('blocked_authors')
      .insert({ id: randomUUID(), userId: a.id, authorKey: key });
    expect(error?.code).toBe(UNIQUE);
  });

  it('a key without a profile: or company: prefix fails the check', async () => {
    for (const bad of ['jane', 'profile:', 'person:jane']) {
      const { error } = await a.client
        .from('blocked_authors')
        .insert({ id: randomUUID(), userId: a.id, authorKey: bad });
      expect(error?.code).toBe(CHECK);
    }
  });

  it('the owner deletes their own row', async () => {
    const { error } = await a.client
      .from('blocked_authors')
      .delete()
      .eq('authorKey', key);
    expect(error).toBeNull();
    const { data } = await a.client.from('blocked_authors').select('*');
    expect(data).toEqual([]);
  });
});
