'use client';

import { useRouter } from 'next/navigation';
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
import { cn } from '@/lib/utils';
import { MatchDetail } from './match-detail';
import { MatchEmpty } from './match-empty';
import { MatchFilters } from './match-filters';
import { MatchList } from './match-list';

type Profile = { id: string; label: string; state: 'draft' | 'published' };

/**
 * The matches page: the list beside the selected job from `md` up, one or the other below
 * it. Every choice lives in the URL; the server reloads on navigation.
 */
export function MatchesView({
  jobs,
  profiles,
  labels,
  initial: state,
  now: nowIso,
  userId,
  selected,
}: {
  /** Grouped jobs of the last 7 days, published profiles only. */
  jobs: MatchedJob[];
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
        kind="no-matches-24h"
        weekHref={href({ ...state, tab: '7d' })}
      />
    );
  else list = <MatchEmpty kind="no-matches-7d" />;

  // In one profile, show that profile's reasons when it matched the job.
  const own = selected?.filter((r) => r.profileId === state.profile) ?? [];
  const detailRows = own.length ? own : (selected ?? []);
  let detail: React.ReactNode;
  if (state.job === null) detail = <MatchEmpty kind="pick" />;
  else if (detailRows.length === 0) detail = <MatchEmpty kind="not-found" />;
  else
    detail = (
      <MatchDetail
        key={state.job}
        rows={detailRows}
        labels={labels}
        profileLabels={profileLabels}
        now={now}
        userId={userId}
        backHref={href({ ...state, job: null })}
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
            'flex flex-col gap-3 md:sticky md:top-4 md:max-h-svh md:w-96 md:shrink-0 md:self-start md:overflow-y-auto',
            state.job && 'hidden md:flex',
          )}
        >
          <MatchFilters
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
