import { randomUUID } from 'node:crypto';
import { isLocalUrl } from '@xjobs/database/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Users come from Supabase Auth: the sign-up trigger creates their users row.
export function admin(): SupabaseClient {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'The e2e tests create auth users: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (locally: eval "$(scripts/supabase-env.sh)").',
    );
  }
  if (!isLocalUrl(SUPABASE_URL)) {
    throw new Error(
      `The e2e tests create and delete auth users: refusing non-local SUPABASE_URL ${new URL(SUPABASE_URL).hostname}.`,
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Creates a confirmed auth user and returns its id, which is also its users row id. */
export async function createAuthUser(name = 'e2e'): Promise<string> {
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}@xjobs.test`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create auth user: ${error.message}`);
  return data.user.id;
}

export async function deleteAuthUser(id: string): Promise<void> {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error && !/not found/i.test(error.message)) {
    throw new Error(`Could not delete auth user ${id}: ${error.message}`);
  }
}
