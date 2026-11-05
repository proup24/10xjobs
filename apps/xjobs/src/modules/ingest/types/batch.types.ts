import type { Channel } from 'src/common/enums';
import type { RawCollectedItem } from '../../collectors/types/collector';

export type { RawCollectedItem };

/** The stored, untouched result of one segment run (format version 1). */
export interface BatchFile {
  formatVersion: 1;
  batchId: string;
  channel: Channel;
  segmentRunId: string;
  /** ISO 8601 UTC; the segment's `until`. */
  observedAt: string;
  source: { actor: string; apifyRunId: string | null };
  queries: { id: string; keyword: string; params: Record<string, unknown> }[];
  itemsByQuery: Record<string, RawCollectedItem[]>;
  unattributed: RawCollectedItem[];
}

export type BatchStatus = 'pending' | 'ingested' | 'failed';

/**
 * What ingesting one batch did. `invalid` (rejected before storage) and
 * `normalizeInvalid` (stored raw, but no job) are full counts; `errors` is
 * capped and shared by both stages.
 */
export interface BatchReport {
  received: number;
  newItems: number;
  newVersions: number;
  repeats: number;
  invalid: number;
  /** Items linked to a normalized job. */
  normalized: number;
  normalizeInvalid: number;
  /** Jobs this batch created, sent to Process as `new`. */
  newJobs: number;
  /** Jobs this batch found after three weeks unseen, sent back to Process. */
  reopened: number;
  errors: {
    stage: 'validate' | 'normalize';
    queryId: string | null;
    index: number;
    reason: string;
  }[];
}
