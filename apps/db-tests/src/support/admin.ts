import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadStackEnv, type StackEnv } from './stack-env.js';

export const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
};

let stackEnv: StackEnv | undefined;
// The CLI lookup spawns a process, so resolve it once per test process.
export function stack(): StackEnv {
  stackEnv ??= loadStackEnv();
  return stackEnv;
}

/**
 * The service-role client. It creates users and fixture rows and may read back
 * state to confirm an outcome, but it never performs the operation under test:
 * that always goes through a signed-in user's (or anon) client.
 */
export function admin(): SupabaseClient {
  const { url, serviceRoleKey } = stack();
  return createClient(url, serviceRoleKey, noSession);
}
