'use client';

import { useId, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { deleteProfileAction } from '@/app/(app)/preferences/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Props = {
  profileId: string;
  /** The profile's nav label, named in the confirmation. */
  label: string;
  /** The user's only profile: it can't be deleted. */
  isLast: boolean;
};

/**
 * Deletes a profile after a confirmation. On success the action redirects, so the
 * dialog stays pending until the next page has loaded; a refusal or failure toasts.
 */
export function DeleteProfileButton({ profileId, label, isLast }: Props) {
  const hintId = useId();
  const [, startTransition] = useTransition();

  function remove(): Promise<void> {
    // In a transition, so the action's redirect reaches Next's redirect boundary.
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          // Only a refusal or failure comes back; a delete redirects instead.
          await deleteProfileAction(profileId);
          notifySaveFailed();
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
            disabled={isLast}
            aria-describedby={isLast ? hintId : undefined}
          >
            Delete profile
          </Button>
        }
      />
      {isLast && (
        <p id={hintId} className="text-sm text-muted-foreground">
          You need at least one profile
        </p>
      )}
    </div>
  );
}
