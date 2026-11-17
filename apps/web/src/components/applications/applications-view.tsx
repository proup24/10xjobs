'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DISMISS_REASON_LABELS,
  type DismissReason,
} from '@xjobs/database/enums';
import { clearJobDecisionAction, decideJobAction } from '@/app/(app)/actions';
import {
  BackLink,
  MatchDetail,
  PostLinks,
} from '@/components/matches/match-detail';
import { DismissDialog } from '@/components/matches/dismiss-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DecisionRow } from '@/lib/applications/load';
import {
  APP_STATUSES,
  appViewHref,
  isAppStatus,
  viewForJob,
  type AppStatus,
  type AppView,
} from '@/lib/applications/view-state';
import type { Labels } from '@/lib/matches/checks';
import { timeAgo } from '@/lib/matches/freshness';
import type { MatchRow } from '@/lib/matches/group';
import type { JobPosting } from '@/lib/matches/postings';
import type { SaveResult } from '@/lib/setup/save-result';
import { cn } from '@/lib/utils';
import { DecisionRowLink, dismissReason } from './decision-row';

const STATUS_LABELS: Record<AppStatus, string> = {
  applied: 'Applied',
  dismissed: 'Not for me',
  expired: 'Expired',
};

const EMPTY_TEXT: Record<AppStatus, string> = {
  applied: 'Jobs you mark applied show here',
  dismissed: 'Jobs you mark not for me show here',
  expired: 'Jobs you mark expired show here',
};

const BACK_LABEL = 'Back to applications';

const MOVE_BACK_TEXT =
  'Move back to Matches? It shows there again only if it still matches and was seen in the last 7 days.';

function Nothing({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

/** A decided job whose match is gone: what the decision row knows, with no match section. */
function JobHeader({
  row,
  userId,
  backHref,
  actions,
}: {
  row: DecisionRow;
  userId: string;
  backHref: string;
  actions: React.ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-6">
      <BackLink href={backHref} label={BACK_LABEL} />
      <header className="flex flex-col gap-1">
        <h2 className="text-title-3">{row.title}</h2>
        <p>
          {row.companyName}
          {row.location && (
            <span className="text-muted-foreground"> · {row.location}</span>
          )}
        </p>
      </header>
      <PostLinks
        postingUrl={row.postingUrl}
        applyUrl={row.applyUrl}
        userId={userId}
        jobId={row.jobId}
      />
      {actions}
    </article>
  );
}

type Save = (
  input:
    | { status: 'applied' }
    | { status: 'expired' }
    | { status: 'dismissed'; reason?: DismissReason; note?: string },
) => Promise<boolean>;

/** The decision and the ways to change or undo it. */
function DecisionActions({
  row,
  now,
  onSave,
  onClear,
}: {
  row: DecisionRow;
  now: Date;
  onSave: Save;
  /** Removes the decision; rejects when it was not removed. */
  onClear(): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const { status } = row;
  const reason = dismissReason(row);
  const note = row.note as string | null;
  const ago = timeAgo(new Date(row.decidedAt), now);

  const heading = {
    applied: `Applied ${ago}`,
    dismissed: `Not for me · ${ago}`,
    expired: `Marked expired ${ago}`,
  }[status];

  const moveBack = (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          Move back to Matches
        </Button>
      }
      title="Move back to Matches"
      description={MOVE_BACK_TEXT}
      confirmLabel="Move back"
      onConfirm={onClear}
      onError={() => undefined}
    />
  );

  const markApplied = (
    <Button
      variant="secondary"
      loading={pending}
      onClick={async () => {
        setPending(true);
        try {
          await onSave({ status: 'applied' });
        } finally {
          setPending(false);
        }
      }}
    >
      Mark applied
    </Button>
  );

  const moveToNotForMe = (variant: 'secondary' | 'outline') => (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() => setDismissing(true)}
    >
      Move to Not for me
    </Button>
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-title-5">{heading}</h3>
        {row.closed && <Badge variant="secondary">Closed</Badge>}
      </div>
      {status === 'dismissed' && (
        <dl className="flex flex-col gap-2">
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{reason ? DISMISS_REASON_LABELS[reason] : 'No reason'}</dd>
          </div>
          {note && (
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Note</dt>
              <dd className="break-words whitespace-pre-line">{note}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {status === 'applied' && moveToNotForMe('secondary')}
        {status === 'dismissed' && (
          <>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDismissing(true)}
            >
              Edit reason
            </Button>
            {markApplied}
          </>
        )}
        {status === 'expired' && (
          <>
            {markApplied}
            {moveToNotForMe('outline')}
          </>
        )}
        {moveBack}
      </div>
      <DismissDialog
        open={dismissing}
        onOpenChange={setDismissing}
        initial={status === 'dismissed' ? { reason, note } : undefined}
        onConfirm={(extra) => onSave({ status: 'dismissed', ...extra })}
      />
    </section>
  );
}

/**
 * The Applications page: the user's applied, not-for-me or expired jobs beside the selected one from
 * `md` up, one or the other below it. The choice lives in the URL; the server reloads on
 * navigation.
 */
export function ApplicationsView({
  decisions,
  initial,
  now: nowIso,
  userId,
  labels,
  profileLabels,
  selected,
  postings,
}: {
  /** Every decision of the user, newest first. */
  decisions: DecisionRow[];
  initial: AppView;
  now: string;
  userId: string;
  labels: Labels;
  profileLabels: Record<string, string>;
  /** The `job` param's match rows, any outcome; null without one, empty when it has none. */
  selected: MatchRow[] | null;
  /** The postings merged into the open job; empty without one. */
  postings: JobPosting[];
}) {
  const router = useRouter();
  const now = new Date(nowIso);
  const state = viewForJob(initial, decisions);
  const href = (next: Partial<AppView>) => appViewHref({ ...state, ...next });

  const byStatus = Object.fromEntries(
    APP_STATUSES.map((s) => [s, decisions.filter((d) => d.status === s)]),
  ) as Record<AppStatus, DecisionRow[]>;
  const visible = byStatus[state.status];
  const open = decisions.find((d) => d.jobId === state.job) ?? null;

  const refused = (result: SaveResult) =>
    toast.error(
      result.status === 'invalid' && result.errors._form
        ? result.errors._form
        : "Couldn't save. Try again.",
    );

  // A changed status follows the job to its new list; an edited reason stays put.
  const save =
    (row: DecisionRow): Save =>
    async (input) => {
      let result: SaveResult;
      try {
        result = await decideJobAction({ jobId: row.jobId, ...input });
      } catch {
        result = { status: 'failed' };
      }
      if (result.status !== 'saved') {
        refused(result);
        return false;
      }
      if (input.status !== row.status) {
        router.push(href({ status: input.status, job: row.jobId }));
        toast.success(`Moved to ${STATUS_LABELS[input.status]}`);
      } else toast.success('Reason saved');
      router.refresh();
      return true;
    };

  const clear = (row: DecisionRow) => async () => {
    let result: SaveResult;
    try {
      result = await clearJobDecisionAction(row.jobId);
    } catch {
      result = { status: 'failed' };
    }
    if (result.status !== 'saved') {
      refused(result);
      // Keeps the confirm open; the toast has said why.
      throw new Error('not cleared');
    }
    router.push(href({ job: null }));
    router.refresh();
    toast.success('Moved back to Matches');
  };

  const backHref = href({ job: null });
  let detail: React.ReactNode;
  if (state.job === null)
    detail = (
      <Nothing
        title="Choose a job"
        description="Its details and your decision show here."
      />
    );
  else if (!open)
    detail = (
      <div className="flex flex-col gap-6">
        <BackLink href={backHref} label={BACK_LABEL} />
        <Nothing
          title="This job isn't in your applications"
          description="It may have been moved back to Matches."
        />
      </div>
    );
  else {
    const actions = (
      <DecisionActions
        key={`${open.jobId}:${open.status}`}
        row={open}
        now={now}
        onSave={save(open)}
        onClear={clear(open)}
      />
    );
    detail =
      selected && selected.length > 0 ? (
        <MatchDetail
          key={open.jobId}
          rows={selected}
          labels={labels}
          profileLabels={profileLabels}
          now={now}
          userId={userId}
          backHref={backHref}
          backLabel={BACK_LABEL}
          actions={actions}
          postings={postings}
        />
      ) : (
        <JobHeader
          row={open}
          userId={userId}
          backHref={backHref}
          actions={actions}
        />
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className={cn('text-title-3', state.job && 'hidden md:block')}>
        Applications
      </h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <div
          className={cn(
            'flex flex-col gap-3 md:sticky md:top-0 md:-mt-4 md:max-h-svh md:w-96 md:shrink-0 md:self-start md:overflow-y-auto md:pt-4',
            state.job && 'hidden md:flex',
          )}
        >
          <Tabs
            value={state.status}
            onValueChange={(v) => {
              if (isAppStatus(v)) router.push(href({ status: v, job: null }));
            }}
          >
            <TabsList aria-label="Status" className="w-full">
              {APP_STATUSES.map((status) => (
                <TabsTrigger key={status} value={status}>
                  {STATUS_LABELS[status]} ({byStatus[status].length})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {visible.length > 0 ? (
            <ul
              aria-label={STATUS_LABELS[state.status]}
              className="flex flex-col gap-1"
            >
              {visible.map((row) => (
                <li key={row.jobId}>
                  <DecisionRowLink
                    row={row}
                    href={href({ job: row.jobId })}
                    selected={row.jobId === state.job}
                    now={now}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Nothing title={EMPTY_TEXT[state.status]} />
          )}
        </div>
        <div className={cn('min-w-0 flex-1', !state.job && 'hidden md:block')}>
          {detail}
        </div>
      </div>
    </div>
  );
}
