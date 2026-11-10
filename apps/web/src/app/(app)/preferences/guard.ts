import { notFound, redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';
import { loadError } from '@/lib/setup/load';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Client = SupabaseClient<Database>;

export const isProfileId = (id: unknown): id is string =>
  typeof id === 'string' && UUID.test(id);

/** Guards a Preferences page: signed in, or off to /sign-in. */
export async function requireSignedIn(): Promise<{
  supabase: Client;
  userId: string;
}> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect('/sign-in');
  return { supabase, userId };
}

/**
 * Guards a profile's Preferences page: signed in, and the profile is one RLS returns to
 * this user. A malformed id, another user's profile or a deleted one is a 404.
 */
export async function requireOwnProfile(profileId: string): Promise<{
  supabase: Client;
  userId: string;
  profileId: string;
}> {
  const { supabase, userId } = await requireSignedIn();
  if (!isProfileId(profileId)) notFound();
  const r = await supabase
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .maybeSingle();
  if (r.error) throw loadError('profile read', r.error);
  if (!r.data) notFound();
  return { supabase, userId, profileId: r.data.id };
}
