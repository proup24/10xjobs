import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import type { Place } from '@/lib/setup/answers';
import { loadError } from '@/lib/setup/load';
import { readPlaces } from '@/lib/setup/mapping';

export const MAX_PROFILES = 5;

export type ProfileListItem = {
  id: string;
  position: string;
  firstPlace: Place | null;
  hasResume: boolean;
};

/** The user's profiles in creation order, as the Preferences side nav lists them. */
export async function loadProfileList(
  supabase: SupabaseClient<Database>,
): Promise<ProfileListItem[]> {
  const r = await supabase
    .from('profiles')
    .select('id, position, locations, resumeKey')
    .order('createdAt', { ascending: true })
    .order('id', { ascending: true });
  if (r.error) throw loadError('profiles read', r.error);
  return (r.data ?? []).map((row) => ({
    id: row.id,
    position: row.position,
    // Remote places come first, then hybrid, then onsite.
    firstPlace: readPlaces(row.locations)[0]?.place ?? null,
    hasResume: row.resumeKey !== null,
  }));
}

/**
 * One unique label per profile: the position, plus the first place when another profile
 * shares the position, plus " · 2", " · 3" for whatever still clashes.
 */
export function profileLabels(
  items: ProfileListItem[],
  positionLabel: (code: string) => string,
  placeLabel: (p: Place) => string,
): Map<string, string> {
  const shared = new Map<string, number>();
  for (const i of items)
    shared.set(i.position, (shared.get(i.position) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const i of items) {
    let label = positionLabel(i.position);
    if ((shared.get(i.position) ?? 0) > 1 && i.firstPlace) {
      label += ` · ${placeLabel(i.firstPlace)}`;
    }
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(i.id, n > 1 ? `${label} · ${n}` : label);
  }
  return out;
}
