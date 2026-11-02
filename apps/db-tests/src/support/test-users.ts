import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadStackEnv, type StackEnv } from './stack-env.js';

export type TestUser = { id: string; email: string; client: SupabaseClient };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const createdIds = new Set<string>();

let stackEnv: StackEnv | undefined;
// The CLI lookup spawns a process, so resolve it once per test process.
function stack(): StackEnv {
  stackEnv ??= loadStackEnv();
  return stackEnv;
}

// Module-private: the service role only creates and deletes users, never reads data.
function adminClient(): SupabaseClient {
  const { url, serviceRoleKey } = stack();
  return createClient(url, serviceRoleKey, noSession);
}

export async function createTestUser(): Promise<TestUser> {
  const { url, anonKey } = stack();
  const email = `db-test-${randomUUID()}@xjobs.test`;
  const password = randomUUID();

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create test user: ${error.message}`);
  createdIds.add(data.user.id);

  const client = createClient(url, anonKey, noSession);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error)
    throw new Error(`Could not sign in test user: ${signedIn.error.message}`);

  return { id: data.user.id, email, client };
}

export async function cleanupTestUsers(): Promise<void> {
  if (createdIds.size === 0) return;
  const admin = adminClient();
  for (const id of [...createdIds]) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Could not delete test user ${id}: ${error.message}`);
    }
    createdIds.delete(id);
  }
}
