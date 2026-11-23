import { redirect } from 'next/navigation';
import { MatchesView } from '@/components/matches/matches-view';
import { loadMatches } from '@/lib/matches/load';
import { loadPostings } from '@/lib/matches/postings';
import { decidedJobHref, selectedRows } from '@/lib/matches/selected';
import { groupByJob, publishedRows, undecidedRows } from '@/lib/matches/group';
import {
  defaultProfile,
  knownProfile,
  readViewState,
} from '@/lib/matches/view-state';
import { engineClient } from '@/lib/engine/server';
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

/** The notice is advisory: a failed read means no notice, never a failed page. */
async function readSearches() {
  try {
    const result = await (await engineClient()).searchesState();
    if (result.kind !== 'ok') return null;
    const { paused, lastActiveAt } = result.data;
    return {
      paused,
      lastActiveAt: lastActiveAt ? new Date(lastActiveAt) : null,
    };
  } catch {
    return null;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect('/sign-in');

  const now = new Date();
  const params = toParams(await searchParams);
  const profilesRead = preferenceProfiles().then(({ items, labels }) =>
    items.map((p) => ({
      id: p.id,
      label: labels[p.id] ?? p.position,
      state: p.state,
    })),
  );
  // The window has list rows only; the job in the URL is read in full, alongside it, from
  // the list it was opened in. Both lists are read, for the counts on their tabs.
  const since = new Date(now.getTime() - WEEK_MS);
  const asked = readViewState(params);
  const outcome = asked.list === 'review' ? 'review' : 'qualified';
  const [rows, reviewRows, profiles, lists, selected, postings, searches] =
    await Promise.all([
      loadMatches(supabase, { since, outcome: 'qualified' }),
      loadMatches(supabase, { since, outcome: 'review' }),
      profilesRead,
      preferenceLists(),
      selectedRows(supabase, asked.job, profilesRead, outcome),
      loadPostings(supabase, asked.job),
      readSearches(),
    ]);
  // A decided job opened by link (a match webhook's) shows where it now lives.
  const decided = decidedJobHref(selected);
  if (decided) redirect(decided);
  const read = readViewState(params, {
    tab: '24h',
    profile: defaultProfile(profiles),
  });
  // A stale or foreign profile link shows the default profile, not an empty one.
  const state = { ...read, profile: knownProfile(read.profile, profiles) };
  const live = publishedRows(undecidedRows(rows), profiles);
  const liveReview = publishedRows(undecidedRows(reviewRows), profiles);

  return (
    <MatchesView
      jobs={groupByJob(live)}
      reviewJobs={groupByJob(liveReview)}
      profiles={profiles}
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
      initial={state}
      now={now.toISOString()}
      userId={userId}
      selected={selected}
      postings={postings}
      searches={searches}
    />
  );
}
