import { checkLocation } from './location';
import type { PlaceIndex } from './places';
import { checkPosition } from './position';
import { checkSeniority } from './seniority';
import { checkStack, type ImpliesMap } from './stack';
import type { Check, MatchJob, MatchProfile } from './types';

export interface MatchContext {
  places: PlaceIndex;
  implies: ImpliesMap;
}

export interface Decision {
  outcome: 'qualified' | 'rejected';
  unverified: boolean;
  stackScore: number | null;
  /** Always four checks, in the order position, seniority, location, stack. */
  checks: Check[];
}

/** Runs every rule (no early exit) and combines them into one decision. */
export function decide(
  job: MatchJob,
  profile: MatchProfile,
  ctx: MatchContext,
): Decision {
  const doc = job.document;
  const stack = checkStack(doc.techStack.value, profile.skills, ctx.implies);
  let position = checkPosition(doc, profile);
  // Location and seniority are often unstated even on good postings, but a job
  // whose role and stack both say nothing has nothing to show it fits.
  if (position.outcome === 'unknown' && stack.check.outcome === 'unknown') {
    position = {
      ...position,
      outcome: 'fail',
      reason: `neither the role nor the stack could be verified (${position.reason}; ${stack.check.reason})`,
    };
  }
  const checks: Check[] = [
    position,
    checkSeniority(doc, profile),
    checkLocation(doc.openings, profile, ctx.places),
    stack.check,
  ];
  const rejected = checks.some((c) => c.outcome === 'fail');
  const unknown = checks.some((c) => c.outcome === 'unknown');
  return {
    outcome: rejected ? 'rejected' : 'qualified',
    unverified: !rejected && (unknown || job.needsReview),
    stackScore: stack.score,
    checks,
  };
}
