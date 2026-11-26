import { DISMISS_REASONS } from '@xjobs/database/enums';
import { z } from 'zod';
import type { Feedback } from './callbacks.repository';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.discriminatedUnion('type', [
  z.object({ version: z.literal(1), type: z.literal('ping') }),
  z.object({
    version: z.literal(1),
    type: z.literal('feedback'),
    jobId: z.string().regex(UUID_PATTERN),
    status: z.enum(['applied', 'dismissed']),
    reason: z.enum(DISMISS_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  }),
]);

export type ParsedCallback =
  | { type: 'ping' }
  | { type: 'feedback'; feedback: Feedback }
  | { type: 'invalid'; error: string };

const invalid = (error: string): ParsedCallback => ({ type: 'invalid', error });

/** Parses body v1. Anything else is `invalid`, with a short error that names no values. */
export function parseCallbackBody(raw: Buffer): ParsedCallback {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return invalid('body is not JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join('.') || 'body';
    return invalid(`invalid ${path}`);
  }
  const body = parsed.data;
  if (body.type === 'ping') return { type: 'ping' };
  if (body.status === 'applied') {
    if (body.reason !== undefined || body.note !== undefined)
      return invalid('reason and note need status dismissed');
    return {
      type: 'feedback',
      feedback: { jobId: body.jobId, status: 'applied' },
    };
  }
  return {
    type: 'feedback',
    feedback: {
      jobId: body.jobId,
      status: 'dismissed',
      ...(body.reason !== undefined && { reason: body.reason }),
      ...(body.note ? { note: body.note } : {}),
    },
  };
}
