'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import type { SearchSwitchKey, SearchSwitchView } from '@xjobs/engine-client';
import { setSearchSwitchAction } from '@/app/(app)/preferences/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

const COPY: Record<SearchSwitchKey, { label: string; description: string }> = {
  posts: {
    label: 'Search LinkedIn posts',
    description:
      'Looks every hour for hiring posts that match this profile. English posts are searched for remote work only.',
  },
  indeed: {
    label: 'Search Indeed',
    description:
      "Searches Indeed for this profile's technologies in the countries it names, and for remote jobs in the US, Brazil, Poland, the UK and Canada.",
  },
};

type Props = { profileId: string; view: SearchSwitchView };

/**
 * Turns one search switch on or off for a profile. Optimistic: the switch flips at once
 * and reverts, with a toast, when the engine refuses or fails.
 */
export function SearchSwitch({ profileId, view }: Props) {
  const id = useId();
  const [enabled, setEnabled] = useState(view.enabled);
  const [, startTransition] = useTransition();
  const copy = COPY[view.key];
  // Formatted after mount: the server's time zone differs from the viewer's, so formatting
  // during render would break hydration.
  const [pausedAt, setPausedAt] = useState('tomorrow');
  useEffect(() => {
    if (!view.pausedUntil) return;
    setPausedAt(
      new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(view.pausedUntil)),
    );
  }, [view.pausedUntil]);

  function change(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setSearchSwitchAction>> = 'failed';
      try {
        result = await setSearchSwitchAction(profileId, view.key, next);
      } catch {
        // Treated as a failure below.
      }
      if (result === 'saved') return;
      setEnabled(!next);
      notifySaveFailed();
    });
  }

  return (
    <Field orientation="horizontal">
      <Switch id={id} checked={enabled} onCheckedChange={change} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{copy.label}</FieldLabel>
        <FieldDescription>
          <span>{copy.description}</span>
          {view.key === 'posts' && view.searches === 0 && (
            <span className="mt-1 block">
              No post searches for this profile: English posts are searched for
              remote work only, and it has no remote places.
            </span>
          )}
          {view.key === 'posts' && view.pausedUntil !== null && (
            <span className="mt-1 block">
              Post searches are paused until {pausedAt} because today&apos;s
              search budget is used up. They catch up on what they missed when
              they restart.
            </span>
          )}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}
