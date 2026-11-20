'use client';

import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { PostSearchView } from '@xjobs/engine-client';
import { setPostSearchAction } from '@/app/(app)/preferences/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

type Props = { profileId: string; initial: PostSearchView };

/**
 * Turns LinkedIn post search on for a profile. Optimistic: the switch flips at once and
 * reverts, with a toast, when the engine refuses or fails.
 */
export function PostSearchSwitch({ profileId, initial }: Props) {
  const id = useId();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [, startTransition] = useTransition();

  function change(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setPostSearchAction>> = 'failed';
      try {
        result = await setPostSearchAction(profileId, next);
      } catch {
        // Treated as a failure below.
      }
      if (result === 'saved') return;
      setEnabled(!next);
      if (result === 'forbidden')
        toast.error("Post search isn't available for your account.");
      else notifySaveFailed();
    });
  }

  return (
    <Field orientation="horizontal">
      <Switch id={id} checked={enabled} onCheckedChange={change} />
      <FieldContent>
        <FieldLabel htmlFor={id}>Search LinkedIn posts</FieldLabel>
        <FieldDescription>
          <span>
            Looks every hour for hiring posts that match this profile. English
            posts are searched for remote work only.
          </span>
          {initial.searches === 0 && (
            <span className="mt-1 block">
              No post searches for this profile: English posts are searched for
              remote work only, and it has no remote places.
            </span>
          )}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}
