'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import type { SearchSwitchKey, SearchSwitchView } from '@xjobs/engine-client';
import {
  setSearchSwitchAction,
  type SearchSwitchResult,
} from '@/app/(app)/preferences/actions';
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
  // The engine's pause for the saved state: from the page, then from each save, since a
  // save does not refresh the page.
  const [pausedUntil, setPausedUntil] = useState(view.pausedUntil);
  const copy = COPY[view.key];
  // Formatted after mount: the server's time zone differs from the viewer's, so formatting
  // during render would break hydration.
  const [pausedAt, setPausedAt] = useState('tomorrow');
  useEffect(() => {
    if (!pausedUntil) return;
    const date = new Date(pausedUntil);
    if (Number.isNaN(date.getTime())) return;
    setPausedAt(
      new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date),
    );
  }, [pausedUntil]);

  function change(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      let result: SearchSwitchResult = { status: 'failed' };
      try {
        result = await setSearchSwitchAction(profileId, view.key, next);
      } catch {
        // Treated as a failure below.
      }
      if (result.status === 'saved') {
        setPausedUntil(result.pausedUntil);
        return;
      }
      setEnabled(!next);
      notifySaveFailed();
    });
  }

  const noSearches = view.key === 'posts' && view.searches === 0;
  // Only while the switch is on: a user who turns posts off is not paused.
  const paused =
    view.key === 'posts' && enabled && !noSearches && pausedUntil !== null;

  return (
    <Field orientation="horizontal">
      <Switch id={id} checked={enabled} onCheckedChange={change} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{copy.label}</FieldLabel>
        <FieldDescription>
          <span>{copy.description}</span>
          {noSearches && (
            <span className="mt-1 block">
              No post searches for this profile: English posts are searched for
              remote work only, and it has no remote places.
            </span>
          )}
          {paused && (
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
