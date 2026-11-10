'use client';

import { useId, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { deleteProfileAction } from '@/app/(app)/preferences/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ONLY_RESUME_HINT } from '@/lib/preferences/delete-profile-hints';
import { toast } from 'sonner';

type Props = {
  profileId: string;
  /** The profile's nav label, named in the confirmation. */
  label: string;
  /**
   * Why the profile can't be deleted: it is the user's only profile, or the only one
   * with a resume. Null when it can.
   */
  blockedReason: BlockedReason;
};

export type BlockedReason = 'last' | 'only-resume' | null;

const HINTS = {
  last: 'You need at least one profile',
  'only-resume': ONLY_RESUME_HINT,
} as const;

/**
 * Deletes a profile after a confirmation. On success the action redirects, so the
 * dialog stays pending until the next page has loaded; a refusal or failure toasts.
 */
export function DeleteProfileButton({
  profileId,
  label,
  blockedReason,
}: Props) {
  const hintId = useId();
  const hint = blockedReason ? HINTS[blockedReason] : null;
  const [, startTransition] = useTransition();

  function remove(): Promise<void> {
    // In a transition, so the action's redirect reaches Next's redirect boundary.
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          // Only a refusal or failure comes back; a delete redirects instead.
          const result = await deleteProfileAction(profileId);
          // A stale page: the profile became the only one with a resume meanwhile.
          if (result === 'only-resume') toast.error(ONLY_RESUME_HINT);
          else notifySaveFailed();
        } catch (e) {
          // The redirect after a delete arrives as a rejection: let Next handle it.
          unstable_rethrow(e);
          notifySaveFailed();
        }
        resolve();
      });
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <ConfirmDialog
        destructive
        title={`Delete ${label}?`}
        description="This removes the profile and its resume. It can't be undone."
        confirmLabel="Delete profile"
        onConfirm={remove}
        trigger={
          <Button
            variant="outline"
            disabled={blockedReason !== null}
            aria-describedby={hint ? hintId : undefined}
          >
            Delete profile
          </Button>
        }
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
