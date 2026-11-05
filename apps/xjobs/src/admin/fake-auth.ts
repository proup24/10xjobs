import type { User } from '@supabase/supabase-js';
import type { AdminAuth } from '@xjobs/database/auth';

export type FakeAuth = AdminAuth & {
  calls: {
    invite: string[];
    generateLink: { type: string; email: string }[];
    update: { id: string; attrs: Record<string, unknown> }[];
  };
};

export function makeUser(over: Partial<User> & { email: string }): User {
  return {
    id: `id-${over.email}`,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: undefined,
    ...over,
  } as unknown as User;
}

/** A recording stand-in for the Supabase admin auth API. */
export function fakeAuth(
  users: User[] = [],
  opts: {
    inviteError?: { code: string; message: string };
    linkError?: { message: string };
  } = {},
): FakeAuth {
  const calls: FakeAuth['calls'] = { invite: [], generateLink: [], update: [] };
  return {
    calls,
    listUsers: async () => ({
      data: { users, aud: 'authenticated' },
      error: null,
    }),
    inviteUserByEmail: async (email: string) => {
      calls.invite.push(email);
      if (opts.inviteError) {
        return { data: { user: null }, error: opts.inviteError };
      }
      return { data: { user: makeUser({ email }) }, error: null };
    },
    generateLink: async (params: { type: string; email: string }) => {
      calls.generateLink.push({ type: params.type, email: params.email });
      if (opts.linkError) {
        return { data: { properties: null }, error: opts.linkError };
      }
      return {
        data: { properties: { hashed_token: 'hash-1' } },
        error: null,
      };
    },
    updateUserById: async (id: string, attrs: Record<string, unknown>) => {
      calls.update.push({ id, attrs });
      return { data: { user: makeUser({ email: 'x' }) }, error: null };
    },
  } as unknown as FakeAuth;
}
