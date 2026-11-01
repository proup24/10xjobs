import type { ClosedQuestionKey } from '../models/types';

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

/** Null for an unknown model or key: the question always goes to the fallback. */
export function thresholdFor(
  model: string,
  key: ClosedQuestionKey,
): number | null {
  const table = THRESHOLDS[model];
  if (!table) return null;
  const k = key.startsWith('junk:') ? 'junk' : key;
  return table[k as keyof typeof table] ?? null;
}
