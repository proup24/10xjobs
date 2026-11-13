import { normalizeConfig } from '../config';

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'archived';
export type ProcessingReason = 'new' | 'reopened';

export interface ProcessingState {
  status: ProcessingStatus | null;
  reason: ProcessingReason | null;
  requestedAt: Date | null;
}

/**
 * Whether this observation sends the job to Process: when it creates the job,
 * or when the job had gone unseen for `reopenAfterMs`. Uses observation time,
 * so replaying an old batch never reopens anything. An `archived` job goes
 * back to `pending` on an observation newer than its last one (never on a
 * replay or a rebuild). Ingest only
 * ever sets `pending`; the other statuses belong to Process.
 */
export function nextProcessing(input: {
  created: boolean;
  previousLastSeenAt: Date | null;
  observedAt: Date;
  current: ProcessingState;
  rebuild: boolean;
}): ProcessingState {
  if (input.rebuild) return input.current;
  if (input.created)
    return { status: 'pending', reason: 'new', requestedAt: input.observedAt };
  if (input.current.status === 'archived') {
    if (
      input.previousLastSeenAt &&
      input.observedAt.getTime() <= input.previousLastSeenAt.getTime()
    )
      return input.current;
    return {
      status: 'pending',
      reason: 'reopened',
      requestedAt: input.observedAt,
    };
  }
  if (
    input.previousLastSeenAt &&
    input.observedAt.getTime() - input.previousLastSeenAt.getTime() >=
      normalizeConfig.reopenAfterMs
  )
    return {
      status: 'pending',
      reason: 'reopened',
      requestedAt: input.observedAt,
    };
  return input.current;
}
