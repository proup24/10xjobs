import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

const keys: string[] = [];

afterAll(async () => {
  if (keys.length > 0)
    await admin().from('silenced_authors').delete().in('authorKey', keys);
  await cleanupTestUsers();
});

/** A silenced author row, as the engine writes one. */
function row() {
  const authorKey = `profile:test-${randomUUID()}`;
  return {
    id: randomUUID(),
    authorKey,
    name: 'Test Author',
    reason: 'aggregator',
    origin: 'manual',
    evidence: null,
    createdBy: null,
  };
}

describe('silenced_authors', () => {
  let a: TestUser;
  let seeded: ReturnType<typeof row>;

  beforeAll(async () => {
    a = await createTestUser();
    seeded = row();
    const { error } = await admin().from('silenced_authors').insert(seeded);
    if (error) throw new Error(`admin insert: ${error.message}`);
    keys.push(seeded.authorKey);
  });

  it('exists for the admin', async () => {
    const { data, error } = await admin()
      .from('silenced_authors')
      .select('authorKey, origin')
      .eq('authorKey', seeded.authorKey);
    expect(error).toBeNull();
    expect(data).toEqual([{ authorKey: seeded.authorKey, origin: 'manual' }]);
  });

  it('is never readable by a signed-in user', async () => {
    const { data } = await a.client.from('silenced_authors').select('*');
    expect(data ?? []).toEqual([]);
  });

  it('rejects an insert by a signed-in user with a privilege error', async () => {
    const { error } = await a.client.from('silenced_authors').insert(row());
    expect(error?.code).toBe('42501');
  });

  it("rejects an origin other than 'manual' or 'automatic'", async () => {
    const { error } = await admin()
      .from('silenced_authors')
      .insert({ ...row(), origin: 'other' });
    expect(error?.code).toBe('23514');
  });
});
