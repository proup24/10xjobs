'use client';

import { Check, Clock, Minus, RotateCw, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { DeliveryRow } from '@/lib/webhook/load';
import { cn } from '@/lib/utils';

/** Attempts before a row fails; a pending row with attempts shows "attempt n of 7". */
const MAX_ATTEMPTS = 7;

type Tone = 'success' | 'destructive' | 'muted';

/** What a row's outcome reads: the status, then the HTTP code or the error. */
export function deliveryStatus(r: DeliveryRow): {
  text: string;
  tone: Tone;
  icon: typeof Check;
} {
  const detail = r.lastStatusCode ?? r.lastError;
  const withDetail = (s: string) => (detail ? `${s} · ${detail}` : s);
  switch (r.status) {
    case 'delivered':
      return { text: withDetail('Delivered'), tone: 'success', icon: Check };
    case 'failed':
      return { text: withDetail('Failed'), tone: 'destructive', icon: X };
    case 'pending':
      return r.attempts > 0
        ? {
            text: withDetail(`attempt ${r.attempts} of ${MAX_ATTEMPTS}`),
            tone: 'muted',
            icon: RotateCw,
          }
        : { text: 'Pending', tone: 'muted', icon: Clock };
    case 'sending':
      return { text: 'Sending', tone: 'muted', icon: RotateCw };
    default:
      return { text: 'Skipped', tone: 'muted', icon: Minus };
  }
}

const TONES: Record<Tone, string> = {
  success: 'text-success',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

/**
 * "16 Nov, 10:02": a fixed locale, so the server and every browser spell it the same; in
 * `timeZone`, or the runtime's own zone when unset.
 */
export function formatDeliveryTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

const noSubscribe = () => () => undefined;
/**
 * The server (and the hydration pass) render UTC, labelled; the browser then renders the
 * viewer's zone. useSyncExternalStore switches after hydration, so the two never mismatch.
 */
function DeliveryTime({ iso }: { iso: string }) {
  const local = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return (
    <time dateTime={iso} className="shrink-0 font-mono text-muted-foreground">
      {local
        ? formatDeliveryTime(iso)
        : `${formatDeliveryTime(iso, 'UTC')} UTC`}
    </time>
  );
}

function what(r: DeliveryRow): string {
  if (r.kind === 'test') return 'Test';
  if (!r.title) return 'A job no longer in your matches';
  return r.companyName ? `${r.title} · ${r.companyName}` : r.title;
}

/** The last deliveries, newest first: time, job or "Test", profile, outcome. */
export function WebhookDeliveries({
  deliveries,
}: {
  deliveries: DeliveryRow[];
}) {
  if (deliveries.length === 0) {
    return <p className="text-muted-foreground">No deliveries yet.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {deliveries.map((r) => {
        const status = deliveryStatus(r);
        const Icon = status.icon;
        return (
          <li
            key={r.id}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
          >
            <DeliveryTime iso={r.createdAt} />
            <span className="min-w-0 flex-1 break-words">{what(r)}</span>
            {r.profileLabel && (
              <span className="text-muted-foreground">{r.profileLabel}</span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 self-center',
                TONES[status.tone],
              )}
            >
              <Icon aria-hidden />
              {status.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
