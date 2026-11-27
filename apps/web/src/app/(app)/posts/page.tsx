import { redirect } from 'next/navigation';
import { PostsView } from '@/components/posts/posts-view';
import { groupByJob, publishedRows } from '@/lib/matches/group';
import { loadMatches } from '@/lib/matches/load';
import { decidedJobHref, selectedRows } from '@/lib/matches/selected';
import { defaultProfile, knownProfile } from '@/lib/matches/view-state';
import {
  loadJunk,
  loadPostDetails,
  loadPostExtras,
  loadRescues,
} from '@/lib/posts/load';
import { failedReasons, toListRow } from '@/lib/posts/lists';
import { readPostsViewState } from '@/lib/posts/view-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { preferenceLists, preferenceProfiles } from '../preferences/data';

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

/** The selected job's list read: Matches reads every outcome (a rescue may be a rejected row). */
const SELECTED_OUTCOME = {
  matches: null,
  review: 'review',
  disqualified: 'rejected',
} as const;

/** Matches' social posts sub-page: post roles and junk posts, for profiles with post search on. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect('/sign-in');

  const { items, labels: names } = await preferenceProfiles();
  const profiles = items
    .filter((p) => p.postSearch)
    .map((p) => ({
      id: p.id,
      label: names[p.id] ?? p.position,
      state: p.state,
    }));
  // With post search off everywhere there are no social posts: the job board is all of Matches.
  if (profiles.length === 0) redirect('/');

  const now = new Date();
  const since = new Date(now.getTime() - WEEK_MS);
  const params = toParams(await searchParams);
  const asked = readPostsViewState(params);
  const kind = 'post_role' as const;
  const listReads = Promise.all([
    loadMatches(supabase, { since, outcome: 'qualified', kind }),
    loadMatches(supabase, { since, outcome: 'review', kind }),
    // Full rows for their failed checks; cut back to list rows before they reach the client.
    loadMatches(supabase, { since, outcome: 'rejected', kind, details: true }),
    loadJunk(supabase, since),
    loadRescues(supabase),
  ]);
  // The extras start as soon as the lists are in, alongside the other reads.
  const extrasRead = listReads.then(([q, r, rej, j, res]) =>
    loadPostExtras(supabase, [
      ...new Set([
        ...[q, r, rej].flatMap((rows) =>
          publishedRows(rows, profiles).map((row) => row.jobId),
        ),
        ...j.map((x) => x.jobId),
        ...res.map((x) => x.jobId),
      ]),
    ]),
  );
  const [
    [qualifiedRows, reviewRows, rejectedFull, junk, rescues],
    extras,
    lists,
    selectedRead,
    details,
  ] = await Promise.all([
    listReads,
    extrasRead,
    preferenceLists(),
    asked.list === 'junk'
      ? Promise.resolve(null)
      : selectedRows(
          supabase,
          asked.job,
          profiles,
          SELECTED_OUTCOME[asked.list],
          kind,
        ),
    loadPostDetails(supabase, asked.job),
  ]);
  const rescued = new Set(rescues.map((r) => r.jobId));
  // On Matches, the open job's qualified rows (a review row moved to Matches included), or all
  // of a rescued job's rows.
  const selected =
    asked.list === 'matches' && selectedRead && !rescued.has(asked.job ?? '')
      ? selectedRead.filter(
          (r) => r.outcome === 'qualified' || r.reviewChoice === 'qualified',
        )
      : selectedRead;
  // A decided job opened by link shows where it now lives.
  const decided = decidedJobHref(selected);
  if (decided) redirect(decided);

  const read = readPostsViewState(params, {
    tab: '24h',
    profile: defaultProfile(profiles),
  });
  // A stale or foreign profile link shows the default profile, not an empty one.
  const state = { ...read, profile: knownProfile(read.profile, profiles) };
  const qualified = groupByJob(publishedRows(qualifiedRows, profiles));
  const review = groupByJob(publishedRows(reviewRows, profiles));
  const rejectedRows = publishedRows(rejectedFull, profiles);
  const rejected = groupByJob(rejectedRows.map(toListRow));

  return (
    <PostsView
      qualified={qualified}
      review={review}
      rejected={rejected}
      junk={junk}
      rescues={rescues}
      extras={Object.fromEntries(extras)}
      failedReasons={failedReasons(rejectedRows)}
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
      details={details}
    />
  );
}
