import { describe, expect, it } from 'vitest';
import { fakeAuth, makeUser } from './fake-auth';
import {
  blockUser,
  inviteUser,
  listAuthUsers,
  normalizeEmail,
  signInLink,
  unblockUser,
} from './users-admin';

describe('users admin', () => {
  it('normalizes by trimming and lowercasing', () => {
    expect(normalizeEmail('  Me@Example.COM ')).toBe('me@example.com');
  });

  it('normalizes before looking up and inviting', async () => {
    const fake = fakeAuth();
    await inviteUser(fake, '  Me@Example.COM ');
    expect(fake.calls.invite).toEqual(['me@example.com']);
  });

  it('invites a new email', async () => {
    const fake = fakeAuth();
    expect(await inviteUser(fake, 'me@example.com')).toEqual({
      ok: true,
      message: 'Invited me@example.com.',
    });
  });

  it('finds an existing user typed in a different case', async () => {
    const fake = fakeAuth([
      makeUser({ email: 'me@example.com', email_confirmed_at: undefined }),
    ]);
    const r = await inviteUser(fake, 'Me@Example.com');
    expect(r.message).toBe('Re-sent the invite to me@example.com.');
  });

  it('re-sends to a pending invitee', async () => {
    const fake = fakeAuth([
      makeUser({ email: 'me@example.com', email_confirmed_at: undefined }),
    ]);
    expect(await inviteUser(fake, 'me@example.com')).toEqual({
      ok: true,
      message: 'Re-sent the invite to me@example.com.',
    });
    expect(fake.calls.invite).toEqual(['me@example.com']);
  });

  it('changes nothing for a signed-up user', async () => {
    const fake = fakeAuth([makeUser({ email: 'me@example.com' })]);
    expect(await inviteUser(fake, 'me@example.com')).toEqual({
      ok: true,
      message: 'me@example.com has already signed up; nothing changed.',
    });
    expect(fake.calls.invite).toEqual([]);
  });

  it('maps email_exists from Supabase to the same message', async () => {
    const fake = fakeAuth([], {
      inviteError: { code: 'email_exists', message: 'exists' },
    });
    expect(await inviteUser(fake, 'me@example.com')).toEqual({
      ok: true,
      message: 'me@example.com has already signed up; nothing changed.',
    });
  });

  it('fails on other invite errors', async () => {
    const fake = fakeAuth([], {
      inviteError: { code: 'unexpected', message: 'boom' },
    });
    const r = await inviteUser(fake, 'me@example.com');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('boom');
  });

  it('blocks with a 100-year ban and keeps data', async () => {
    const fake = fakeAuth([makeUser({ id: 'u1', email: 'me@example.com' })]);
    expect(await blockUser(fake, ' ME@example.com')).toEqual({
      ok: true,
      message: 'Blocked me@example.com. Their data is kept.',
    });
    expect(fake.calls.update).toEqual([
      { id: 'u1', attrs: { ban_duration: '876000h' } },
    ]);
  });

  it('unblocks with ban_duration none', async () => {
    const fake = fakeAuth([makeUser({ id: 'u1', email: 'me@example.com' })]);
    expect(await unblockUser(fake, 'me@example.com')).toEqual({
      ok: true,
      message: 'Unblocked me@example.com.',
    });
    expect(fake.calls.update).toEqual([
      { id: 'u1', attrs: { ban_duration: 'none' } },
    ]);
  });

  it('fails block/unblock for an unknown email', async () => {
    const fake = fakeAuth();
    const expected = { ok: false, message: 'No user with email a@b.co.' };
    expect(await blockUser(fake, 'a@b.co')).toEqual(expected);
    expect(await unblockUser(fake, 'a@b.co')).toEqual(expected);
    expect(fake.calls.update).toEqual([]);
  });

  it('lists pending, active and blocked users', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const fake = fakeAuth([
      makeUser({ email: 'p@x.co', email_confirmed_at: undefined }),
      makeUser({
        email: 'a@x.co',
        last_sign_in_at: '2026-02-02T00:00:00.000Z',
      }),
      makeUser({ email: 'b@x.co', banned_until: future }),
      makeUser({ email: 'old@x.co', banned_until: past }),
      makeUser({
        email: 'bp@x.co',
        email_confirmed_at: undefined,
        banned_until: future,
      }),
    ]);
    const r = await listAuthUsers(fake);
    expect(r.ok).toBe(true);
    expect(r.message.split('\n')).toEqual([
      'p@x.co  pending  never',
      'a@x.co  active  2026-02-02T00:00:00.000Z',
      'b@x.co  blocked  never',
      'old@x.co  active  never',
      'bp@x.co  blocked  never',
    ]);
  });

  describe('signInLink', () => {
    it('prints a confirm link for a known user', async () => {
      const auth = fakeAuth([makeUser({ email: 'admin@xjobs.local' })]);
      expect(
        await signInLink(auth, ' Admin@xjobs.local ', 'http://localhost:3001'),
      ).toEqual({
        ok: true,
        message:
          'http://localhost:3001/auth/confirm?token_hash=hash-1&type=email',
      });
      expect(auth.calls.generateLink).toEqual([
        { type: 'magiclink', email: 'admin@xjobs.local' },
      ]);
    });

    it('refuses an unknown email without generating a link', async () => {
      const auth = fakeAuth([]);
      expect(
        await signInLink(auth, 'nobody@xjobs.local', 'http://localhost:3001'),
      ).toEqual({
        ok: false,
        message: 'No user with email nobody@xjobs.local.',
      });
      expect(auth.calls.generateLink).toEqual([]);
    });

    it('refuses a blocked user', async () => {
      const auth = fakeAuth([
        makeUser({
          email: 'b@xjobs.local',
          banned_until: '2126-01-01T00:00:00Z',
        }),
      ]);
      expect(
        await signInLink(auth, 'b@xjobs.local', 'http://localhost:3001'),
      ).toEqual({
        ok: false,
        message: 'b@xjobs.local is blocked; unblock them first.',
      });
      expect(auth.calls.generateLink).toEqual([]);
    });

    it('reports a generateLink error', async () => {
      const auth = fakeAuth([makeUser({ email: 'a@xjobs.local' })], {
        linkError: { message: 'boom' },
      });
      const r = await signInLink(
        auth,
        'a@xjobs.local',
        'http://localhost:3001',
      );
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/^Could not create a sign-in link for/);
    });
  });
});
