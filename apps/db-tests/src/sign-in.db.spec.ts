import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import { expectNoEmailTo, latestEmailTo } from './support/mailpit.js';
import {
  cleanupTestUsers,
  createTestUser,
  inviteTestUserAt,
} from './support/test-users.js';

afterAll(cleanupTestUsers);

const freshEmail = () => `db-test-${randomUUID()}@xjobs.test`;

async function expectNoUser(email: string) {
  const { data, error } = await admin().auth.admin.listUsers({
    perPage: 1000,
  });
  expect(error).toBeNull();
  expect(data.users.some((u) => u.email === email)).toBe(false);
}

describe('invite-only sign-in', () => {
  it('sign-up with the publishable key is refused', async () => {
    const email = freshEmail();
    const { error } = await anon().auth.signUp({
      email,
      password: randomUUID(),
    });
    expect(error?.code).toBe('signup_disabled');
    await expectNoUser(email);
  });

  it('a sign-in request for an unknown email creates no user and sends nothing', async () => {
    const email = freshEmail();
    const { error } = await anon().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    expect(error).not.toBeNull();
    await expectNoUser(email);
    await expectNoEmailTo(email);
  });

  it('an invite email carries a 6-digit code and an invite link', async () => {
    const email = freshEmail();
    await inviteTestUserAt(email);
    const mail = await latestEmailTo(email);
    expect(mail.subject).toBe("You've been invited to 10xjobs");
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.type).toBe('invite');
    expect(mail.tokenHash).not.toBe('');
  });

  it('the invite code verifies with type email and signs the invitee in', async () => {
    const email = freshEmail();
    const { id } = await inviteTestUserAt(email);
    const mail = await latestEmailTo(email);
    const { data, error } = await anon().auth.verifyOtp({
      email,
      token: mail.code,
      type: 'email',
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.user?.id).toBe(id);
  });

  it('the invite link token verifies with type invite', async () => {
    const email = freshEmail();
    await inviteTestUserAt(email);
    const mail = await latestEmailTo(email);
    const { data, error } = await anon().auth.verifyOtp({
      token_hash: mail.tokenHash,
      type: 'invite',
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('a sign-in request for an invited but unaccepted user sends nothing', async () => {
    const email = freshEmail();
    await inviteTestUserAt(email);
    await latestEmailTo(email);
    const t = new Date();
    const { error } = await anon().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    expect(error).not.toBeNull();
    await expectNoEmailTo(email, { after: t });
  });

  it('a sign-in email for an accepted user carries a code and an email-type link', async () => {
    const user = await createTestUser();
    const { error } = await anon().auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false },
    });
    expect(error).toBeNull();
    const mail = await latestEmailTo(user.email);
    expect(mail.subject).toBe('Your 10xjobs sign-in code');
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.type).toBe('email');
    const { data, error: verifyError } = await anon().auth.verifyOtp({
      token_hash: mail.tokenHash,
      type: 'email',
    });
    expect(verifyError).toBeNull();
    expect(data.session).not.toBeNull();
  });
});
