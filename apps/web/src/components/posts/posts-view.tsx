'use client';

import { useRouter } from 'next/navigation';
import { reportMismatchAction } from '@/app/(app)/actions';
import { BackLink, MatchDetail } from '@/components/matches/match-detail';
import { MatchEmpty, type EmptyKind } from '@/components/matches/match-empty';
import { MatchFilters } from '@/components/matches/match-filters';
import { SourceSwitch } from '@/components/matches/source-switch';
import { useJobDecisions } from '@/components/matches/use-job-decisions';
import type { Labels } from '@/lib/matches/checks';
import type { MatchedJob, MatchRow } from '@/lib/matches/group';
import { defaultProfile } from '@/lib/matches/view-state';
import type {
  JunkRow,
  PostDetails,
  PostExtras,
  RescueRow,
} from '@/lib/posts/load';
import {
  buildPostLists,
  pickFailedReason,
  selectPostItems,
} from '@/lib/posts/lists';
import {
  postsViewStateHref,
  type PostList,
  type PostsViewState,
} from '@/lib/posts/view-state';
import { cn } from '@/lib/utils';
import { PostRow } from './post-row';

type Profile = { id: string; label: string; state: 'draft' | 'published' };

const LISTS: { value: PostList; label: string }[] = [
  { value: 'matches', label: 'Matches' },
  { value: 'review', label: 'Review' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'junk', label: 'Junk' },
];

type DayKind = Extract<EmptyKind, { weekHref: string }>['kind'];
type WeekKind =
  | 'no-matches-7d'
  | 'no-review-7d'
  | 'no-disqualified-7d'
  | 'no-junk-7d';

const EMPTY: Record<PostList, { day: DayKind; week: WeekKind }> = {
  matches: { day: 'no-matches-24h', week: 'no-matches-7d' },
  review: { day: 'no-review-24h', week: 'no-review-7d' },
  disqualified: { day: 'no-disqualified-24h', week: 'no-disqualified-7d' },
  junk: { day: 'no-junk-24h', week: 'no-junk-7d' },
};

/**
 * The social posts page: four tabs (Matches, Review, Disqualified, Junk) beside the selected
 * post from `md` up, one or the other below it. Every choice lives in the URL.
 */
export function PostsView({
  qualified,
  review,
  rejected,
  junk,
  rescues,
  extras,
  failedReasons,
  profiles,
  labels,
  initial: state,
  now: nowIso,
  userId,
  selected,
}: {
  /** Grouped qualified post roles of the last 7 days, post-search profiles only. */
  qualified: MatchedJob[];
  /** Grouped review post roles of the last 7 days. */
  review: MatchedJob[];
  /** Grouped rejected post roles of the last 7 days, as list rows. */
  rejected: MatchedJob[];
  junk: JunkRow[];
  rescues: RescueRow[];
  /** Per-job extras (apply kinds, Email pending), by job id. */
  extras: Record<string, PostExtras>;
  /** Disqualified's first failed check reason, by job then profile (computed on the server). */
  failedReasons: Record<string, Record<string, string>>;
  /** The profiles with post search on. */
  profiles: Profile[];
  labels: Labels;
  initial: PostsViewState;
  now: string;
  userId: string;
  /** The `job` param's match rows; null without one (or on Junk). */
  selected: MatchRow[] | null;
  /** The open post's details; the post section renders them. */
  details: PostDetails | null;
}) {
  const router = useRouter();
  const now = new Date(nowIso);
  const defaults = { tab: '24h', profile: defaultProfile(profiles) } as const;
  const href = (next: PostsViewState) => postsViewStateHref(next, defaults);
  const go = (next: Partial<PostsViewState>) =>
    router.push(href({ ...state, ...next }));
  const { decide, decideJob } = useJobDecisions(state.job, (job) =>
    href({ ...state, job }),
  );

  const lists = buildPostLists({ qualified, review, rejected, junk, rescues });
  const base = { profileId: state.profile, now };
  const countOf = (list: PostList) =>
    selectPostItems(lists[list], { ...base, list, tab: '7d' }).length;
  const counts = {
    '24h': selectPostItems(lists[state.list], {
      ...base,
      list: state.list,
      tab: '24h',
    }).length,
    '7d': countOf(state.list),
  };
  const visible = selectPostItems(lists[state.list], {
    ...base,
    list: state.list,
    tab: state.tab,
  });

  const profileLabels = Object.fromEntries(
    profiles.map((p) => [p.id, p.label]),
  );
  const published = profiles.filter((p) => p.state === 'published');
  const profileItems =
    profiles.length > 1
      ? [
          ...(published.length >= 2
            ? [{ value: 'all', label: 'All profiles' }]
            : []),
          ...profiles.map((p) => ({
            value: p.id,
            label: p.state === 'draft' ? `${p.label} (Draft)` : p.label,
          })),
        ]
      : null;
  const isDraft =
    profiles.find((p) => p.id === state.profile)?.state === 'draft';
  const listLabel = LISTS.find((l) => l.value === state.list)?.label;

  let list: React.ReactNode;
  if (isDraft)
    list = (
      <MatchEmpty
        kind="draft"
        finishHref={`/preferences/new/${state.profile}/resume`}
      />
    );
  else if (visible.length > 0)
    list = (
      <ul aria-label={listLabel} className="flex flex-col gap-1">
        {visible.map((item) => (
          <li key={item.jobId}>
            <PostRow
              item={item}
              list={state.list}
              extras={extras[item.jobId]}
              href={href({ ...state, job: item.jobId })}
              selected={item.jobId === state.job}
              now={now}
              failedReason={pickFailedReason(
                failedReasons[item.jobId],
                state.profile,
              )}
              showProfiles={state.profile === 'all'}
              profileLabels={profileLabels}
            />
          </li>
        ))}
      </ul>
    );
  else {
    const empty: EmptyKind =
      state.tab === '24h'
        ? {
            kind: EMPTY[state.list].day,
            weekHref: href({ ...state, tab: '7d' }),
          }
        : { kind: EMPTY[state.list].week };
    list = <MatchEmpty {...empty} />;
  }

  // In one profile, show that profile's reasons when it matched the job.
  const own = selected?.filter((r) => r.profileId === state.profile) ?? [];
  const detailRows = own.length ? own : (selected ?? []);
  const backHref = href({ ...state, job: null });
  let detail: React.ReactNode;
  if (state.job === null) detail = <MatchEmpty kind="pick" />;
  else if (detailRows.length === 0)
    detail = (
      <div className="flex flex-col gap-6">
        <BackLink href={backHref} />
        <MatchEmpty kind="not-found" />
      </div>
    );
  else
    detail = (
      <MatchDetail
        key={state.job}
        rows={detailRows}
        labels={labels}
        profileLabels={profileLabels}
        now={now}
        userId={userId}
        backHref={backHref}
        onDecide={state.list === 'review' ? decide : undefined}
        onDecideJob={
          state.list === 'matches' || state.list === 'review'
            ? decideJob(visible.map((i) => i.jobId))
            : undefined
        }
        onReport={reportMismatchAction}
        postings={[]}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2',
          state.job && 'hidden md:flex',
        )}
      >
        <h1 className="text-title-3">Social posts</h1>
        <SourceSwitch current="posts" />
      </div>
      <div className="flex flex-col gap-6 md:flex-row">
        <div
          className={cn(
            'flex flex-col gap-3 md:sticky md:top-0 md:-mt-4 md:max-h-svh md:w-96 md:shrink-0 md:self-start md:overflow-y-auto md:pt-4',
            state.job && 'hidden md:flex',
          )}
        >
          <MatchFilters
            lists={LISTS.map((l) => ({ ...l, count: countOf(l.value) }))}
            list={state.list}
            onList={(v) => {
              const next = LISTS.find((l) => l.value === v)?.value;
              if (next) go({ list: next, job: null });
            }}
            profileItems={profileItems}
            profile={state.profile}
            onProfile={(profile) => go({ profile })}
            sourceItems={isDraft ? null : []}
            source="all"
            onSource={() => undefined}
            tab={state.tab}
            counts={counts}
            onTab={(tab) => go({ tab })}
          />
          {list}
        </div>
        <div className={cn('min-w-0 flex-1', !state.job && 'hidden md:block')}>
          {detail}
        </div>
      </div>
    </div>
  );
}
