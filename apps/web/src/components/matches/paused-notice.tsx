'use client';

import { useState } from 'react';
import { resumeSearchesAction } from '@/app/(app)/searches-actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { shortDate } from '@/lib/matches/freshness';

/**
 * Tells a user whose searches are paused for inactivity, and resumes them. Hides at once on
 * a successful resume; a failure keeps the notice and says so.
 */
export function PausedNotice({ lastActiveAt }: { lastActiveAt: Date | null }) {
  const [state, setState] = useState<'idle' | 'resuming' | 'failed' | 'done'>(
    'idle',
  );
  if (state === 'done') return null;

  const resume = async () => {
    setState('resuming');
    try {
      const { ok } = await resumeSearchesAction();
      setState(ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Searches only you need are paused</CardTitle>
        <CardDescription>
          {lastActiveAt
            ? `No activity since ${shortDate(lastActiveAt)}.`
            : 'No recent activity.'}{' '}
          Mark a job, or resume now.
        </CardDescription>
        {state === 'failed' && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t resume your searches. Try again.
          </p>
        )}
        <CardAction>
          <Button onClick={resume} loading={state === 'resuming'}>
            Resume searches
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
