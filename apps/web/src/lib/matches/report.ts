import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@xjobs/database/types';
import {
  SAVED,
  failure,
  fieldErrors,
  logger,
  type Deps,
  type SaveResult,
} from '@/lib/setup/save-result';
import { factQuotes, type FactLines } from './facts';
import type { MatchRow } from './group';

/**
 * The fact lines a user can report, plus the facts the matcher reads without showing them
 * on their own line; those are reported from a review that rests on them.
 */
const FACT_FIELDS = [
  'role',
  'seniority',
  'arrangement',
  'places',
  'contractType',
  'engagement',
  'salary',
] as const satisfies readonly (keyof FactLines)[];

export const REPORT_FIELDS = [
  ...FACT_FIELDS,
  'yearsRequired',
  'techStack',
  'requiredLanguages',
  'workAuthorization',
] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];

export const FactReport = z.object({
  jobId: z.uuid(),
  field: z.enum(REPORT_FIELDS),
  proposedValue: z
    .string()
    .trim()
    .min(1, 'Enter what it should say.')
    .max(200, 'Use 200 characters or fewer.'),
  note: z.string().trim().max(500, 'Use 500 characters or fewer.').optional(),
});
export type FactReport = z.infer<typeof FactReport>;

export const NOT_IN_MATCHES = 'This job is no longer in your matches.';

/** The key of `facts` that holds each reportable field. */
const FACT_KEY: Record<ReportField, string> = {
  role: 'position',
  seniority: 'seniority',
  arrangement: 'arrangement',
  places: 'openings',
  contractType: 'contractType',
  engagement: 'engagement',
  salary: 'salary',
  yearsRequired: 'yearsRequired',
  techStack: 'techStack',
  requiredLanguages: 'requiredLanguages',
  workAuthorization: 'workAuthorization',
};

type Client = SupabaseClient<Database>;
type Json =
  Database['public']['Tables']['fact_reports']['Insert']['processorValue'];

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** The user's row on the job, whichever list it is in. */
async function readRow(
  supabase: Client,
  jobId: string,
): Promise<{ row?: MatchRow; error?: unknown }> {
  for (const outcome of ['qualified', 'review'] as const) {
    const r = await supabase.rpc('match_details', {
      p_job_id: jobId,
      p_outcome: outcome,
    });
    if (r.error) return { error: r.error };
    if (r.data?.[0]) return { row: r.data[0] };
  }
  return {};
}

/**
 * Logs a mismatch the user found between a fact and the job post. The processor's value,
 * its quote, the listing's value and the extraction id are copied from the job's `match_details` row here, never
 * taken from the client. A job the user has no match on is `invalid`. Nothing reads these
 * reports yet. Log lines carry ids and error codes only.
 */
export async function saveReport(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = FactReport.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const { jobId, field, proposedValue, note } = parsed.data;
  const log = logger(deps);

  const read = await readRow(supabase, jobId);
  if (read.error)
    return failure(log, `match read job=${jobId}`, read.error, 'report');
  const row = read.row;
  if (!row) {
    log(`report: no match row job=${jobId}`);
    return { status: 'invalid', errors: { _form: NOT_IN_MATCHES } };
  }

  const key = FACT_KEY[field];
  const quotes = factQuotes(row.facts, key);
  const conflict = (Array.isArray(row.conflicts) ? row.conflicts : []).find(
    (c) => asRecord(c)?.field === field,
  );
  const insert = await supabase.from('fact_reports').insert({
    userId,
    jobId,
    extractionId: row.extractionId ?? null,
    field,
    processorValue: (asRecord(row.facts)?.[key] ?? null) as Json,
    quote: quotes.length ? quotes.join('\n') : null,
    listingValue: (asRecord(conflict)?.listingValue ?? null) as Json,
    proposedValue,
    note: note ? note : null,
  });
  if (insert.error)
    return failure(log, `insert job=${jobId}`, insert.error, 'report');
  return SAVED;
}
