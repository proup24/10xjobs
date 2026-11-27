'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  clearJobDecisionAction,
  decideJobAction,
  decideReviewAction,
} from '@/app/(app)/actions';
import type { SaveResult } from '@/lib/setup/save-result';
import type { Decide, DecideJob } from './match-detail';

/**
 * The detail's decisions for the job open in the URL (`job`), shared by the job board and the
 * social posts page. `hrefFor` is the page's URL with another job open (null: none).
 */
export function useJobDecisions(
  job: string | null,
  hrefFor: (job: string | null) => string,
): { decide: Decide; decideJob: (visibleJobIds: string[]) => DecideJob } {
  const router = useRouter();
  // A decided job leaves the review list: close it and read the lists again.
  const decide: Decide = async (d) => {
    const result = await decideReviewAction(d);
    if (result.status === 'saved') {
      router.push(hrefFor(null));
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
    (visibleJobIds: string[]): DecideJob =>
    async (status, extra) => {
      const jobId = job;
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
      const at = visibleJobIds.indexOf(jobId);
      const next = wide()
        ? (visibleJobIds[at + 1] ?? visibleJobIds[at - 1] ?? null)
        : null;
      router.push(hrefFor(next));
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

  return { decide, decideJob };
}
