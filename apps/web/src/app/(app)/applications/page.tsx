import { redirect } from 'next/navigation';
import { ApplicationsView } from '@/components/applications/applications-view';
import { loadDecisions } from '@/lib/applications/load';
import { readAppView } from '@/lib/applications/view-state';
import { loadMatch } from '@/lib/matches/load';
import { loadPostings } from '@/lib/matches/postings';
import { UUID } from '@/lib/setup/answers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { preferenceLists, preferenceProfiles } from '../preferences/data';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Applications · 10xjobs' };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect('/sign-in');

  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['status', 'job']) {
    const v = first(sp[key]);
    if (v !== undefined) params.set(key, v);
  }
  const view = readAppView(params);
  // The open job's match rows of any outcome and any kind (a listing or a post role), so "Why
  // it matched" shows while one is left.
  // None (or a malformed id, which the uuid argument would refuse) shows the job alone.
  const selectedRead =
    view.job === null
      ? Promise.resolve(null)
      : UUID.test(view.job)
        ? loadMatch(supabase, view.job, null, null)
        : Promise.resolve([]);
  const [decisions, lists, profiles, selected, postings] = await Promise.all([
    loadDecisions(supabase),
    preferenceLists(),
    preferenceProfiles(),
    selectedRead,
    loadPostings(supabase, view.job),
  ]);

  return (
    <ApplicationsView
      decisions={decisions}
      initial={view}
      now={new Date().toISOString()}
      userId={userId}
      labels={{
        positions: lists.positions,
        seniorities: lists.seniorities,
        techs: lists.techs,
        countries: lists.countries,
        regions: lists.regions,
        cities: lists.cities,
        languages: lists.languages,
        currencies: lists.currencies,
        contractTypes: lists.contractTypes,
      }}
      profileLabels={Object.fromEntries(
        profiles.items.map((p) => [p.id, profiles.labels[p.id] ?? p.position]),
      )}
      selected={selected}
      postings={postings}
    />
  );
}
