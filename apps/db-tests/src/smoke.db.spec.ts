import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

describe('database test harness', () => {
  it('each session belongs to its own user', async () => {
    const a = await createTestUser();
    const b = await createTestUser();

    expect((await a.client.auth.getUser()).data.user?.id).toBe(a.id);
    expect((await b.client.auth.getUser()).data.user?.id).toBe(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it('a signed-in user can query the Prisma schema through PostgREST', async () => {
    for (const user of [await createTestUser(), await createTestUser()]) {
      const { error } = await user.client.from('users').select('id').limit(1);
      expect(error).toBeNull();
    }
  });
});
