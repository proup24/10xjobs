import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AdminAuth = Pick<
  SupabaseClient['auth']['admin'],
  'generateLink' | 'inviteUserByEmail' | 'listUsers' | 'updateUserById'
>;

const LIST_PAGE_SIZE = 1000;

/** The auth user with `email` (compared exactly), or `undefined` when there is none. */
export async function findAuthUserByEmail(
  auth: Pick<AdminAuth, 'listUsers'>,
  email: string,
): Promise<User | undefined> {
  for (let page = 1; ; page++) {
    const { data, error } = await auth.listUsers({
      page,
      perPage: LIST_PAGE_SIZE,
    });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    const found = data.users.find((user) => user.email === email);
    if (found) return found;
    if (data.users.length < LIST_PAGE_SIZE) return undefined;
  }
}
