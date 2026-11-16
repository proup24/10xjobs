'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  clearJobDecisionAction,
  decideJobAction,
  decideReviewAction,
  reportMismatchAction,
} from '@/app/(app)/actions';
import type { Labels } from '@/lib/matches/checks';
import {
  selectJobs,
  sourceOptions,
  type MatchedJob,
  type MatchRow,
} from '@/lib/matches/group';
import { channelLabel } from '@/lib/matches/sources';
import {
  defaultProfile,
  viewStateHref,
  type ViewState,
} from '@/lib/matches/view-state';
import type { SaveResult } from '@/lib/setup/save-result';
import { cn } from '@/lib/utils';
import {
  BackLink,
  MatchDetail,
  type Decide,
  type DecideJob,
} from './match-detail';
import { MatchEmpty } from './match-empty';
import { MatchFilters } from './match-filters';
import { MatchList } from './match-list';

type Profile = { id: string; label: string; state: 'draft' | 'published' };

/**
 * The matches page: the list (matches or review) beside the selected job from `md` up, one
 * or the other below it. Every choice lives in the URL; the server reloads on navigation.
 */
export function MatchesView({
  jobs: matchedJobs,
  reviewJobs,
  profiles,
  labels,
  initial: state,
  now: nowIso,
  userId,
  selected,
}: {
  /** Grouped matches of the last 7 days, published profiles only. */
  jobs: MatchedJob[];
  /** Grouped review rows of the last 7 days not yet decided, published profiles only. */
  reviewJobs: MatchedJob[];
  profiles: Profile[];
  labels: Labels;
  initial: ViewState;
  now: string;
  /** The signed-in user, for recording which jobs they open. */
  userId: string;
  /** The `job` param's rows; null without one, empty when it isn't a match. */
  selected: MatchRow[] | null;
}) {
  const router = useRouter();
  const now = new Date(nowIso);
  const defaults = { tab: '24h', profile: defaultProfile(profiles) } as const;
  const href = (next: ViewState) => viewStateHref(next, defaults);
  const go = (next: Partial<ViewState>) =>
    router.push(href({ ...state, ...next }));
  const review = state.list === 'review';
  const jobs = review ? reviewJobs : matchedJobs;
  // A decided job leaves the review list: close it and read the lists again.
  const decide: Decide = async (d) => {
    const result = await decideReviewAction(d);
    if (result.status === 'saved') {
      router.push(href({ ...state, job: null }));
      router.refresh();
    }
    return result;
  };

  const wide = () =>
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(min-width: 768px)').matches;
  const refused = (result: SaveResult) =>
    toast.error(
      result.status === 'invalid' && result.errors._form
        ? result.errors._form
        : "Couldn't save. Try again.",
    );
  // A decided job leaves Matches: open the next one in the list (none on a phone, where
  // an open job hides the list), read the lists again, and offer to take it back.
  const decideJob =
    (visibleJobs: MatchedJob[]): DecideJob =>
    async (status, extra) => {
      const jobId = state.job;
      if (jobId === null) return false;
      let result: SaveResult;
      try {
        result = await decideJobAction({ jobId, status, ...extra });
      } catch {
        result = { status: 'failed' };
      }
      if (result.status !== 'saved') {
        refused(result);
        return false;
      }
      const at = visibleJobs.findIndex((j) => j.jobId === jobId);
      const next = wide()
        ? ((visibleJobs[at + 1] ?? visibleJobs[at - 1])?.jobId ?? null)
        : null;
      router.push(href({ ...state, job: next }));
      router.refresh();
      toast.success('Moved to Applications', {
        action: {
          label: 'Undo',
          onClick: async () => {
            let undone: SaveResult;
            try {
              undone = await clearJobDecisionAction(jobId);
            } catch {
              undone = { status: 'failed' };
            }
            if (undone.status === 'saved') router.refresh();
            else refused(undone);
          },
        },
      });
      return true;
    };

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-title-3">Matches</h1>
        <MatchEmpty kind="no-profile" />
      </div>
    );
  }

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

  const base = { profileId: state.profile, source: state.source, now };
  const inProfile = selectJobs(jobs, { ...base, source: 'all', tab: '7d' });
  const sources = sourceOptions(inProfile);
  if (state.source !== 'all' && !sources.some((s) => s.value === state.source))
    sources.push({ value: state.source, label: channelLabel(state.source) });
  const counts = {
    '24h': selectJobs(jobs, { ...base, tab: '24h' }).length,
    '7d': selectJobs(jobs, { ...base, tab: '7d' }).length,
  };
  const visible = selectJobs(jobs, { ...base, tab: state.tab });
  const listCounts = {
    matches: selectJobs(matchedJobs, { ...base, tab: '7d' }).length,
    review: selectJobs(reviewJobs, { ...base, tab: '7d' }).length,
  };

  let list: React.ReactNode;
  if (isDraft) list = <MatchEmpty kind="draft" />;
  else if (visible.length > 0)
    list = (
      <MatchList
        jobs={visible}
        hrefFor={(job) => href({ ...state, job })}
        selectedJob={state.job}
        now={now}
        showProfiles={state.profile === 'all'}
        profileLabels={profileLabels}
        label={review ? 'Review' : 'Matches'}
      />
    );
  else if (selectJobs(jobs, { ...base, source: 'all', tab: state.tab }).length)
    list = (
      <MatchEmpty
        kind="filtered"
        clearHref={href({ ...state, source: 'all' })}
      />
    );
  else if (state.tab === '24h')
    list = (
      <MatchEmpty
        kind={review ? 'no-review-24h' : 'no-matches-24h'}
        weekHref={href({ ...state, tab: '7d' })}
      />
    );
  else list = <MatchEmpty kind={review ? 'no-review-7d' : 'no-matches-7d'} />;

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
        onDecide={review ? decide : undefined}
        onDecideJob={decideJob(visible)}
        onReport={reportMismatchAction}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className={cn('text-title-3', state.job && 'hidden md:block')}>
        Matches
      </h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <div
          className={cn(
            'flex flex-col gap-3 md:sticky md:top-0 md:-mt-4 md:max-h-svh md:w-96 md:shrink-0 md:self-start md:overflow-y-auto md:pt-4',
            state.job && 'hidden md:flex',
          )}
        >
          <MatchFilters
            list={state.list}
            listCounts={listCounts}
            onList={(list) => go({ list, job: null })}
            profileItems={profileItems}
            profile={state.profile}
            onProfile={(profile) => go({ profile })}
            sourceItems={
              isDraft
                ? null
                : [{ value: 'all', label: 'All sources' }, ...sources]
            }
            source={state.source}
            onSource={(source) => go({ source })}
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
