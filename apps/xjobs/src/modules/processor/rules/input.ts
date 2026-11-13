import { createHash } from 'node:crypto';
import type { JobForProcessing, PostingInput } from '../models/types';

/** Keeps one posting a bounded share of the generator's context and cost. */
export const DESCRIPTION_CAP_BYTES = 30_000;

function cut(text: string): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= DESCRIPTION_CAP_BYTES) return { text, truncated: false };
  // toString drops a trailing partial UTF-8 sequence as U+FFFD, so trim it.
  let head = buf
    .subarray(0, DESCRIPTION_CAP_BYTES)
    .toString('utf8')
    .replace(/�+$/, '');
  const at = head.lastIndexOf('\n\n');
  if (at > 0) head = head.slice(0, at);
  return { text: head, truncated: true };
}

export function buildPostingInput(job: JobForProcessing): PostingInput {
  const { text, truncated } = cut(job.descriptionText ?? '');
  return {
    jobId: job.id,
    title: job.title,
    description: text,
    truncated,
  };
}

/** Key-sorted copy of a JSON value, so equal values serialize alike. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** sha256 of the canonical JSON of the input, without `jobId`. */
export function inputHash(input: PostingInput): string {
  const { jobId: _jobId, ...rest } = input;
  return createHash('sha256')
    .update(JSON.stringify(canonical(rest)))
    .digest('hex');
}
