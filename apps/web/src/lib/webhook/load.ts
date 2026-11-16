import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadError } from '@/lib/setup/load';

type Client = SupabaseClient<Database>;

export type WebhookView = {
  url: string;
  secret: string;
  enabled: boolean;
  /** Why it is off: the user turned it off, or the engine did after 10 failed sends. */
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

export type DeliveryRow = {
  id: string;
  kind: string;
  /** The job's title and company for a match row while it is a qualified or in-review match; else null. */
  title: string | null;
  companyName: string | null;
  /** The profile's nav label for a match row; null for a test. */
  profileLabel: string | null;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
};

export const DELIVERY_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A job is matchable while it was last seen within this many days. */
const MATCHABLE_DAYS = 30;

/**
 * The user's webhook and its last 50 deliveries, newest first, read through RLS. Match rows
 * get the job's title and company and the profile's label (`labels`, from the Preferences
 * nav). `normalized_jobs` is engine-only (RLS with no policy), so the job comes from
 * `match_details`, the matches view's read: list reads (no details) of the qualified and the
 * in-review matches whose job was seen since 30 days before the oldest match delivery, which
 * covers every delivered job, since a job is only matched while seen within 30 days.
 * `qualified` already includes reviews the user approved; `review` adds approved ones whose
 * approval no longer applies (the match was re-decided onto another rule). Otherwise the title
 * and company come from the delivery's stored body (a stand-in send names the job its job
 * merged into); a delivery with neither, e.g. after retention cleared the body, has no title.
 */
export async function loadWebhook(
  supabase: Client,
  labels: Record<string, string> = {},
): Promise<{ webhook: WebhookView | null; deliveries: DeliveryRow[] }> {
  const w = await supabase
    .from('webhooks')
    .select(
      'url, secret, enabled, disabledReason, consecutiveFailures, lastSuccessAt, lastFailureAt',
    )
    .maybeSingle();
  if (w.error) throw loadError('webhook read', w.error);
  // Deliveries cascade with their webhook: without one there are none.
  if (!w.data) return { webhook: null, deliveries: [] };

  const d = await supabase
    .from('webhook_deliveries')
    .select(
      'id, kind, profileId, jobId, matchId, status, attempts, lastStatusCode, lastError, createdAt, payloadTitle:payload->job->>title, payloadCompany:payload->job->company->>name',
    )
    .order('createdAt', { ascending: false })
    .order('id', { ascending: false })
    .limit(DELIVERY_LIMIT);
  if (d.error) throw loadError('webhook deliveries read', d.error);
  const rows = d.data ?? [];

  const matchRows = rows.filter((r) => r.kind === 'match' && r.jobId);
  const byMatch = new Map<string, { title: string; companyName: string }>();
  const byJob = new Map<string, { title: string; companyName: string }>();
  if (matchRows.length > 0) {
    const oldest = Math.min(
      ...matchRows.map((r) => new Date(r.createdAt).getTime()),
    );
    const since = new Date(oldest - MATCHABLE_DAYS * DAY_MS).toISOString();
    const reads = await Promise.all(
      (['qualified', 'review'] as const).map((outcome) =>
        supabase.rpc('match_details', {
          p_details: false,
          p_outcome: outcome,
          p_since: since,
        }),
      ),
    );
    for (const m of reads) {
      if (m.error) throw loadError('webhook jobs read', m.error);
      for (const j of m.data ?? []) {
        const job = { title: j.title, companyName: j.companyName };
        byMatch.set(j.matchId, job);
        byJob.set(`${j.profileId} ${j.jobId}`, job);
      }
    }
  }

  const deliveries = rows.map((r): DeliveryRow => {
    // Last, what the sent body named: a stand-in send (its job merged into another) has no
    // match on its own job. Null once retention clears the payload.
    const sent = r.payloadTitle
      ? { title: r.payloadTitle, companyName: r.payloadCompany }
      : undefined;
    const job =
      r.kind === 'match'
        ? ((r.matchId ? byMatch.get(r.matchId) : undefined) ??
          byJob.get(`${r.profileId} ${r.jobId}`) ??
          sent)
        : undefined;
    return {
      id: r.id,
      kind: r.kind,
      title: job?.title ?? null,
      companyName: job?.companyName ?? null,
      profileLabel: r.profileId ? (labels[r.profileId] ?? 'Profile') : null,
      status: r.status,
      attempts: r.attempts,
      lastStatusCode: r.lastStatusCode,
      lastError: r.lastError,
      createdAt: r.createdAt,
    };
  });
  return { webhook: w.data, deliveries };
}
