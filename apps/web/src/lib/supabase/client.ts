import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { readPublicSupabaseEnv } from './env';

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const { url, publishableKey } = readPublicSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
