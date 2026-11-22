import type { createDatabaseClient } from 'src/database';

type Db = ReturnType<typeof createDatabaseClient>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Raw = Tx['raw'];

/** One sparse figure from the query: a UTC day, a metric and its count (and cost for calls). */
export interface PostFigureRow {
  day: string;
  metric: string;
  n: number | string;
  cost: number | string;
}

export interface PostExtractionDay {
  day: string;
  calls: number;
  cost_usd: number;
  hiring_sure: number;
  hiring_unsure: number;
  not_hiring_sure: number;
  not_hiring_unsure: number;
  junk_sure: number;
  junk_unsure: number;
  role_jobs: number;
  left_window_pending: number;
}

const DAYS = 7;
const COUNTERS = [
  'hiring_sure',
  'hiring_unsure',
  'not_hiring_sure',
  'not_hiring_unsure',
  'junk_sure',
  'junk_unsure',
] as const;

/**
 * Per UTC day (today and the six before, newest first, zeros when empty):
 * the same figures as the processor status endpoint. Figures outside the
 * window are dropped.
 *
 * - calls and cost_usd: logged post extraction calls (not eval runs).
 * - verdicts: current extractions of post jobs, by the extraction's day.
 * - role_jobs: post_role jobs written that day (`processedAt`; role jobs
 *   have no created column, and a rewrite of a role moves its day).
 * - left_window_pending: posts still pending that turned 7 days old on that
 *   day. This is the present state, not a history: a post processed later
 *   drops out of its day's count.
 */
export function shapePostExtraction(
  figures: PostFigureRow[],
  now: Date,
): PostExtractionDay[] {
  const days: PostExtractionDay[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push({
      day: d.toISOString().slice(0, 10),
      calls: 0,
      cost_usd: 0,
      hiring_sure: 0,
      hiring_unsure: 0,
      not_hiring_sure: 0,
      not_hiring_unsure: 0,
      junk_sure: 0,
      junk_unsure: 0,
      role_jobs: 0,
      left_window_pending: 0,
    });
  }
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const f of figures) {
    const row = byDay.get(f.day);
    if (!row) continue;
    const n = Number(f.n);
    if (f.metric === 'calls') {
      row.calls += n;
      row.cost_usd += Number(f.cost);
    } else if (f.metric === 'roles') row.role_jobs += n;
    else if (f.metric === 'left_window_pending') row.left_window_pending += n;
    else {
      const key = f.metric.replace('/', '_') as (typeof COUNTERS)[number];
      if (COUNTERS.includes(key)) row[key] += n;
    }
  }
  for (const d of days) d.cost_usd = Math.round(d.cost_usd * 1e4) / 1e4;
  return days;
}

/** Sparse figures per UTC day for the last 7 days; shaped by `shapePostExtraction`. */
export function postExtractionSql(raw: Raw): ReturnType<Raw['sql']> {
  return raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        WITH since AS (SELECT ((now() AT TIME ZONE 'UTC')::date - 6) AS d)
        SELECT to_char((a."createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
          'calls' AS metric, count(*) AS n, coalesce(sum(a."costUsd"), 0) AS cost
        FROM processing_attempts a, since
        WHERE a."docType" = 'post' AND NOT a.eval
          AND (a."createdAt" AT TIME ZONE 'UTC')::date >= since.d
        GROUP BY 1
        UNION ALL
        SELECT to_char((e."createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
          e.verdict || '/' || e."verdictConfidence", count(*), 0
        FROM job_extractions e
        JOIN normalized_jobs j ON j."currentExtractionId" = e.id, since
        WHERE e."docType" = 'post' AND j.kind = 'post'
          AND e.verdict IS NOT NULL AND e."verdictConfidence" IS NOT NULL
          AND (e."createdAt" AT TIME ZONE 'UTC')::date >= since.d
        GROUP BY 1, 2
        UNION ALL
        SELECT to_char((j."processedAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
          'roles', count(*), 0
        FROM normalized_jobs j, since
        WHERE j.kind = 'post_role'
          AND (j."processedAt" AT TIME ZONE 'UTC')::date >= since.d
        GROUP BY 1
        UNION ALL
        SELECT to_char(((j."firstSeenAt" + interval '7 days') AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
          'left_window_pending', count(*), 0
        FROM normalized_jobs j, since
        WHERE j.kind = 'post' AND j."processingStatus" = 'pending'
          AND j."firstSeenAt" < now() - interval '7 days'
          AND ((j."firstSeenAt" + interval '7 days') AT TIME ZONE 'UTC')::date >= since.d
        GROUP BY 1) t`;
}
