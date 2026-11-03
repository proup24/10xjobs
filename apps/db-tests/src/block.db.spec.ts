import { afterAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import { latestEmailTo } from './support/mailpit.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

// The same call the admin CLI makes to block and unblock.
async function setBan(id: string, banDuration: string) {
  const { error } = await admin().auth.admin.updateUserById(id, {
    ban_duration: banDuration,
  });
  if (error) throw new Error(`Could not update ban: ${error.message}`);
}
const ban = (id: string) => setBan(id, '876000h');
const unban = (id: string) => setBan(id, 'none');

describe('blocked users', () => {
  it('a blocked user cannot refresh, sign in or verify a code, and their rows stay', async () => {
    const a = await createTestUser();
    await ban(a.id);

    expect((await a.client.auth.refreshSession()).error).not.toBeNull();

    await anon().auth.signInWithOtp({
      email: a.email,
      options: { shouldCreateUser: false },
    });
    const mail = await latestEmailTo(a.email); // pins the known gap: the email still arrives
    const v = await anon().auth.verifyOtp({
      email: a.email,
      token: mail.code,
      type: 'email',
    });
    expect(v.error?.code).toBe('user_banned');

    const { data } = await admin().from('users').select('id').eq('id', a.id);
    expect(data).toHaveLength(1);
  });

  it('unblocking restores sign-in', async () => {
    const a = await createTestUser();
    await ban(a.id);
    const blocked = await anon().auth.signInWithPassword({
      email: a.email,
      password: a.password,
    });
    expect(blocked.error).not.toBeNull();

    await unban(a.id);
    const back = await anon().auth.signInWithPassword({
      email: a.email,
      password: a.password,
    });
    expect(back.error).toBeNull();
    expect(back.data.session).not.toBeNull();
  });
});
