import { cache } from 'react';
import {
  loadProfileList,
  profileLabels,
  type ProfileListItem,
} from '@/lib/preferences/profiles';
import { labeller, placeLabeler } from '@/lib/setup/place-label';
import { loadValueLists, type ValueLists } from '@/lib/setup/value-lists';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** The value lists, read once per request however many layouts and pages ask. */
export const preferenceLists = cache(
  async (): Promise<ValueLists> =>
    loadValueLists(await createSupabaseServerClient()),
);

/** The profiles and their nav labels, read once per request. */
export const preferenceProfiles = cache(
  async (): Promise<{
    items: ProfileListItem[];
    labels: Record<string, string>;
  }> => {
    const [items, lists] = await Promise.all([
      createSupabaseServerClient().then(loadProfileList),
      preferenceLists(),
    ]);
    const labels = profileLabels(
      items,
      labeller(lists.positions),
      placeLabeler(lists),
    );
    return { items, labels: Object.fromEntries(labels) };
  },
);
