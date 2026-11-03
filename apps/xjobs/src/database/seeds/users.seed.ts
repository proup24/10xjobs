import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { findAuthUserByEmail } from '../../admin/auth-users';
import type { Seed } from './seed.interface';

const users = [
  { email: 'admin@xjobs.local', name: 'Admin' },
  { email: 'recruiter@xjobs.local', name: 'Recruiter' },
  { email: 'candidate@xjobs.local', name: 'Candidate' },
];

/** Creates the auth user (the sign-up trigger adds its users row) or finds the existing one. */
async function ensureAuthUser(
  auth: SupabaseClient['auth']['admin'],
  email: string,
): Promise<string> {
  const { data, error } = await auth.createUser({ email, email_confirm: true });
  if (!error) return data.user.id;
  if (
    error.code !== 'email_exists' &&
    !/already been registered/i.test(error.message)
  ) {
    throw new Error(`Could not create auth user ${email}: ${error.message}`);
  }
  const id = (await findAuthUserByEmail(auth, email))?.id;
  if (!id)
    throw new Error(`Auth user ${email} is registered but was not listed`);
  return id;
}

export const usersSeed: Seed = {
  name: 'users',
  async run(tx, env) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'The users seed creates auth users: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (locally: eval "$(scripts/supabase-env.sh)").',
      );
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const user of users) {
      const id = await ensureAuthUser(supabase.auth.admin, user.email);
      await tx.orm.public.User.where({ id }).update({ name: user.name });
    }
  },
};
