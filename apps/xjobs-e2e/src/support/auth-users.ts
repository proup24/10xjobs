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

/**
 * Creates a confirmed auth user with a random password, signs in as it through
 * the publishable key, and returns its id (also its users row id) and access token.
 */
export async function createAuthUser(
  name = 'e2e',
): Promise<{ id: string; accessToken: string }> {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'The e2e tests sign in as users: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (locally: eval "$(scripts/supabase-env.sh)").',
    );
  }
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}@xjobs.test`;
  const password = randomUUID();
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create auth user: ${error.message}`);
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(
      `Could not sign in as the e2e user: ${signedIn.error?.message ?? 'no session'}`,
    );
  }
  return { id: data.user.id, accessToken: signedIn.data.session.access_token };
}

/** Answers the two eligibility questions that publishing requires. */
export async function setEligibility(userId: string): Promise<void> {
  const { error } = await admin()
    .from('users')
    .update({ residenceCountry: 'MA', acceptsSponsorship: false })
    .eq('id', userId);
  if (error) throw new Error(`Could not set eligibility: ${error.message}`);
}

export async function deleteAuthUser(id: string): Promise<void> {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error && !/not found/i.test(error.message)) {
    throw new Error(`Could not delete auth user ${id}: ${error.message}`);
  }
}
