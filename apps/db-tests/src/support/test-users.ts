import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { admin, noSession, stack } from './admin.js';

export type TestUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

const createdIds = new Set<string>();

export async function createTestUser(): Promise<TestUser> {
  const { url, anonKey } = stack();
  const email = `db-test-${randomUUID()}@xjobs.test`;
  const password = randomUUID();

  const { data, error } = await admin().auth.admin.createUser({
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

  return { id: data.user.id, email, password, client };
}

/** Invites the given address through the admin API, the path slice 03's invite script takes. */
export async function inviteTestUserAt(email: string): Promise<{ id: string }> {
  const { data, error } = await admin().auth.admin.inviteUserByEmail(email);
  if (error) throw new Error(`Could not invite test user: ${error.message}`);
  createdIds.add(data.user.id);
  return { id: data.user.id };
}

/** Invites a fresh address. */
export function inviteTestUser(): Promise<{ id: string }> {
  return inviteTestUserAt(`db-test-${randomUUID()}@xjobs.test`);
}

/** Removes every object under `resumes/<prefix>`, recursing into folders. */
async function emptyResumeFolder(prefix: string): Promise<void> {
  const bucket = admin().storage.from('resumes');
  const { data, error } = await bucket.list(prefix, { limit: 1000 });
  if (error)
    throw new Error(`Could not list resumes/${prefix}: ${error.message}`);
  const files: string[] = [];
  for (const entry of data) {
    // Folders come back without an id.
    if (entry.id) files.push(`${prefix}/${entry.name}`);
    else await emptyResumeFolder(`${prefix}/${entry.name}`);
  }
  if (files.length > 0) {
    const removed = await bucket.remove(files);
    if (removed.error)
      throw new Error(
        `Could not remove resumes/${prefix}: ${removed.error.message}`,
      );
  }
}

export async function cleanupTestUsers(): Promise<void> {
  if (createdIds.size === 0) return;
  const client = admin();
  for (const id of [...createdIds]) {
    await emptyResumeFolder(id);
    const { error } = await client.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Could not delete test user ${id}: ${error.message}`);
    }
    createdIds.delete(id);
  }
}
