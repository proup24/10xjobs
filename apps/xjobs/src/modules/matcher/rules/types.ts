import type { ExtractionDocument } from 'src/modules/processor/schema';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';

export type CheckOutcome = 'pass' | 'fail' | 'unknown';
export type RuleName = 'position' | 'seniority' | 'location' | 'stack';

export interface Check {
  rule: RuleName;
  outcome: CheckOutcome;
  jobValue: unknown;
  profileValue: unknown;
  reason: string;
  detail?: unknown;
}

export interface MatchSkill {
  technology: string;
  mastery: number;
  importance: number;
}

export interface MatchProfile {
  id: string;
  userId: string;
  position: string;
  seniorities: string[];
  yearsOfExperience: number;
  /** Minutes. */
  timezoneMin: number;
  timezoneMax: number;
  locations: PlacesByArrangement;
  skills: MatchSkill[];
}

export interface MatchJob {
  jobId: string;
  extractionId: string;
  needsReview: boolean;
  document: ExtractionDocument;
}

const RANK: Record<CheckOutcome, number> = { pass: 2, unknown: 1, fail: 0 };

/** Ranks outcomes for "best of": pass > unknown > fail. */
export function bestOutcome(outcomes: CheckOutcome[]): CheckOutcome {
  let best: CheckOutcome = 'fail';
  for (const o of outcomes) if (RANK[o] > RANK[best]) best = o;
  return best;
}
