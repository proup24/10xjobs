import { redirect } from 'next/navigation';
import { MatchesView } from '@/components/matches/matches-view';
import { loadMatches } from '@/lib/matches/load';
import { selectedRows } from '@/lib/matches/selected';
import { groupByJob, publishedRows } from '@/lib/matches/group';
import { defaultProfile, readViewState } from '@/lib/matches/view-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { preferenceLists, preferenceProfiles } from './preferences/data';

export const dynamic = 'force-dynamic';

const WEEK_MS = 7 * 24 * 3600_000;

type SearchParams = Record<string, string | string[] | undefined>;

function toParams(sp: SearchParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) q.set(k, first);
  }
  return q;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/sign-in');

  const now = new Date();
  const [rows, { items, labels: profileLabels }, lists, sp] = await Promise.all(
    [
      loadMatches(supabase, { since: new Date(now.getTime() - WEEK_MS) }),
      preferenceProfiles(),
      preferenceLists(),
      searchParams,
    ],
  );
  const profiles = items.map((p) => ({
    id: p.id,
    label: profileLabels[p.id] ?? p.position,
    state: p.state,
  }));
  const state = readViewState(toParams(sp), {
    tab: '24h',
    profile: defaultProfile(profiles),
  });

  const live = publishedRows(rows, profiles);
  const selected = await selectedRows(supabase, state.job, live, profiles);

  return (
    <MatchesView
      jobs={groupByJob(live)}
      profiles={profiles}
      labels={{
        positions: lists.positions,
        seniorities: lists.seniorities,
        techs: lists.techs,
        countries: lists.countries,
        regions: lists.regions,
        cities: lists.cities,
      }}
      initial={state}
      now={now.toISOString()}
      selected={selected}
    />
  );
}
