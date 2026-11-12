import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';

export type CheckOutcome = 'pass' | 'fail' | 'unknown';
export type RuleName = 'position' | 'seniority' | 'location' | 'stack';

export interface Check {
  rule: RuleName;
  outcome: CheckOutcome;
  jobValue: unknown;
  profileValue: unknown;
  reason: string;
  /** True when the outcome rests on an unsure value (a fail so marked goes to review). */
  unsure: boolean;
  /** The fact the unsure outcome rests on (e.g. `seniority`, `openings`); null when sure. */
  unsureField: string | null;
  detail?: unknown;
}

export type Confidence = 'sure' | 'unsure';

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
  factsHash: string;
  /** From the current extraction; not part of the facts. */
  needsReview: boolean;
  facts: JobFactsDocument;
}

const RANK: Record<CheckOutcome, number> = { pass: 2, unknown: 1, fail: 0 };

/** Ranks outcomes for "best of": pass > unknown > fail. */
export function bestOutcome(outcomes: CheckOutcome[]): CheckOutcome {
  let best: CheckOutcome = 'fail';
  for (const o of outcomes) if (RANK[o] > RANK[best]) best = o;
  return best;
}
