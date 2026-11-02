import { Logger } from '@nestjs/common';
import type { ClosedQuestionKey } from '../models/types';

const logger = new Logger('ProcessorThresholds');
/** Unknown decision models already warned about in this process. */
const warnedModels = new Set<string>();

/** Minimum Jev confidence per question, keyed by the pinned decision model ID. */
export const THRESHOLDS: Record<
  string,
  Partial<Record<ClosedQuestionKey | 'junk', number>>
> = {
  'typesafe/jev-1.14': {
    arrangement: 0.8,
    seniority: 0.8,
    roleKind: 0.8,
    contractType: 0.8,
    engagement: 0.8,
    isSoftwareEngineeringRole: 0.8,
    sponsorshipOffered: 0.8,
    junk: 0.8,
  },
};

/**
 * Null for an unknown model or key: the question always goes to the fallback.
 * An unknown model is warned about once per process (spec §8).
 */
export function thresholdFor(
  model: string,
  key: ClosedQuestionKey,
): number | null {
  const table = THRESHOLDS[model];
  if (!table) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      logger.warn(
        `No Jev thresholds for decision model ${model}; every closed question goes to the extraction model`,
      );
    }
    return null;
  }
  const k = key.startsWith('junk:') ? 'junk' : key;
  return table[k as keyof typeof table] ?? null;
}
