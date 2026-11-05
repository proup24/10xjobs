import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';

/** RLS limits `profiles` to the signed-in user's own rows. */
export async function landingPath(
  supabase: SupabaseClient<Database>,
): Promise<'/setup' | '/'> {
  const { data } = await supabase.from('profiles').select('id').limit(1);
  return data && data.length > 0 ? '/' : '/setup';
}
