import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { seedProfile } from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const PRIVILEGE = '42501';

describe('profiles.postSearch is engine-only', () => {
  let a: TestUser;
  let draft: string;

  beforeAll(async () => {
    a = await createTestUser();
    draft = await seedProfile(a.id);
  });

  it('defaults postSearch to false', async () => {
    const { data, error } = await admin()
      .from('profiles')
      .select('postSearch')
      .eq('id', draft)
      .single();
    expect(error).toBeNull();
    expect(data?.postSearch).toBe(false);
  });

  it("refuses an owner's direct update of postSearch", async () => {
    const { error } = await a.client
      .from('profiles')
      .update({ postSearch: true })
      .eq('id', draft);
    expect(error?.code).toBe(PRIVILEGE);
  });
});
