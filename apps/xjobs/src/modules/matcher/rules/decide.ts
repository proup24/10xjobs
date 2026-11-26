import { checkContractType } from './contract';
import { checkRequiredLanguages } from './languages';
import { checkLocation } from './location';
import type { PlaceIndex } from './places';
import { checkPosition } from './position';
import { checkBlockedAuthor, checkHiringVerdict, checkPostAge } from './post';
import { checkPostingLanguage } from './posting-language';
import { checkCurrency, checkSalary } from './salary';
import { checkSeniority } from './seniority';
import { checkStack, type ImpliesMap } from './stack';
import type { Check, MatchJob, MatchProfile, RuleName } from './types';
import { checkWorkAuthorization } from './work-authorization';

export interface MatchContext {
  places: PlaceIndex;
  implies: ImpliesMap;
  /** Units of each currency per one USD. */
  rates: Map<string, number>;
}

export type MatchOutcome = 'qualified' | 'rejected' | 'review';

export interface Decision {
  /** `rejected` on a sure failure; `review` when every failure rests on an unsure value. */
  outcome: MatchOutcome;
  /** Only on `qualified`: some check rests on an unsure fact (an unknown check, a fact the posting does not state, does not count). */
  unverified: boolean;
  /** On `review`: the first unsure failing check, in rule order, and the fact it rests on. */
  review: { rule: RuleName; field: string } | null;
  stackScore: number | null;
  /**
   * Ten checks for a listing, thirteen for a post role, in the order position, seniority,
   * location, stack, salary, currency, contractType, languages, postingLanguage,
   * workAuthorization, then (post roles) hiringVerdict, blockedAuthor, postAge.
   */
  checks: Check[];
}

/** Runs every rule (no early exit) and combines them into one decision. */
export function decide(
  job: MatchJob,
  profile: MatchProfile,
  ctx: MatchContext,
): Decision {
  const doc = job.facts;
  const stack = checkStack(
    doc.techStack.value,
    profile.skills,
    ctx.implies,
    doc.techStack.confidence,
  );
  let position = checkPosition(doc, profile, stack.check.outcome === 'unknown');
  // Location and seniority are often unstated even on good postings, but a job
  // whose role and stack both say nothing has nothing to show it fits. This rests on two
  // unknowns, not on an unsure value, so it is a sure failure.
  if (position.outcome === 'unknown' && stack.check.outcome === 'unknown') {
    position = {
      ...position,
      outcome: 'fail',
      unsure: false,
      unsureField: null,
      reason: `neither the role nor the stack could be verified (${position.reason}; ${stack.check.reason})`,
    };
  }
  const checks: Check[] = [
    position,
    checkSeniority(doc, profile),
    checkLocation(doc.openings, profile, ctx.places, doc.limitsBindPerson),
    stack.check,
    checkSalary(doc, profile, ctx.rates),
    checkCurrency(doc, profile),
    checkContractType(doc, profile),
    checkRequiredLanguages(doc, profile),
    checkPostingLanguage(doc, profile),
    checkWorkAuthorization(doc, profile, ctx.places),
  ];
  if (job.post !== null)
    checks.push(
      checkHiringVerdict(job.post),
      checkBlockedAuthor(job.post, profile.blockedAuthors),
      checkPostAge(job.post),
    );
  const fails = checks.filter((c) => c.outcome === 'fail');
  const rejected = fails.some((c) => !c.unsure);
  const doubt = fails.find(
    (c): c is Check & { unsure: true; unsureField: string } => c.unsure,
  );
  const outcome: MatchOutcome = rejected
    ? 'rejected'
    : doubt
      ? 'review'
      : 'qualified';
  const unverified = outcome === 'qualified' && checks.some((c) => c.unsure);
  return {
    outcome,
    unverified,
    review:
      outcome === 'review' && doubt
        ? { rule: doubt.rule, field: doubt.unsureField }
        : null,
    stackScore: stack.score,
    checks,
  };
}
