'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { discardNewProfileAction } from '@/app/(app)/preferences/new/actions';
import {
  opensElsewhere,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MAX_PROFILES, PROFILE_LIMIT_HINT } from '@/lib/preferences/profiles';
import { cn } from '@/lib/utils';

const CHOOSER = '/preferences/new';
const FIRST_STEP = '/preferences/new/job';

export const IN_PROGRESS_TITLE = 'You have a new profile in progress';
export const IN_PROGRESS_LEAD =
  'Continue it where you left off, or discard its answers and start over.';

/**
 * "Continue it" and "Start over" for a new profile in progress. Start over deletes the
 * draft, then opens the chooser. Both leave the page, so both go through the guard.
 * `before` runs first, e.g. to close the dialog these sit in.
 */
export function useInProgressChoice(before?: () => void) {
  const router = useRouter();
  const { confirmLeave } = useUnsavedChanges();
  const [pending, setPending] = useState(false);

  const continueIt = () => {
    before?.();
    confirmLeave(() => router.push(FIRST_STEP));
  };

  const startOver = () =>
    confirmLeave(async () => {
      setPending(true);
      let result: 'discarded' | 'failed';
      try {
        result = await discardNewProfileAction();
      } catch {
        result = 'failed';
      }
      setPending(false);
      if (result === 'failed') {
        notifySaveFailed();
        return;
      }
      before?.();
      router.push(CHOOSER);
      // Already on the chooser, the push alone wouldn't re-read the (now gone) draft.
      router.refresh();
    });

  return { continueIt, startOver, pending };
}

type Props = {
  /** How many profiles the user has. */
  count: number;
  /** Whether a new profile's draft exists. */
  draftInProgress: boolean;
};

/**
 * "+ New profile" under the nav's Profiles group. The nav renders it twice (side column
 * and phone block), so its ids come from `useId` and each copy keeps its own dialog.
 */
export function NewProfileAction({ count, draftInProgress }: Props) {
  const hintId = useId();
  const router = useRouter();
  const { confirmLeave } = useUnsavedChanges();
  const [open, setOpen] = useState(false);
  const { continueIt, startOver, pending } = useInProgressChoice(() =>
    setOpen(false),
  );

  const label = (
    <>
      <Plus aria-hidden="true" data-icon="inline-start" />
      New profile
    </>
  );
  const look = cn(
    buttonVariants({ variant: 'ghost', size: 'sm' }),
    'justify-start self-start',
  );

  if (count >= MAX_PROFILES) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-start self-start"
          disabled
          aria-describedby={hintId}
        >
          {label}
        </Button>
        <p id={hintId} className="px-2 text-xs text-muted-foreground">
          {PROFILE_LIMIT_HINT}
        </p>
      </div>
    );
  }

  if (!draftInProgress) {
    return (
      <Link
        href={CHOOSER}
        className={look}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          confirmLeave(() => router.push(CHOOSER));
        }}
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start self-start"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{IN_PROGRESS_TITLE}</DialogTitle>
            <DialogDescription>{IN_PROGRESS_LEAD}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              loading={pending}
              onClick={startOver}
            >
              Start over
            </Button>
            <Button type="button" disabled={pending} onClick={continueIt}>
              Continue it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The same choice as a page block, for a direct visit to the chooser with a draft. */
export function InProgressChoice() {
  const { continueIt, startOver, pending } = useInProgressChoice();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-title-4">{IN_PROGRESS_TITLE}</h2>
        <p className="text-muted-foreground">{IN_PROGRESS_LEAD}</p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          loading={pending}
          onClick={startOver}
        >
          Start over
        </Button>
        <Button type="button" disabled={pending} onClick={continueIt}>
          Continue it
        </Button>
      </div>
    </div>
  );
}
