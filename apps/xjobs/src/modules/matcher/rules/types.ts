import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';

export type CheckOutcome = 'pass' | 'fail' | 'unknown';
export type RuleName =
  | 'position'
  | 'seniority'
  | 'location'
  | 'stack'
  | 'salary'
  | 'currency'
  | 'contractType'
  | 'languages'
  | 'postingLanguage'
  | 'workAuthorization'
  | 'hiringVerdict'
  | 'blockedAuthor'
  | 'postAge';

/**
 * Whether a check's outcome rests on an unsure value (a fail so marked goes to review),
 * and the fact it rests on (e.g. `seniority`, `openings`): always named when unsure.
 */
export type Sureness =
  | { unsure: false; unsureField: null }
  | { unsure: true; unsureField: string };

/** Sure when no field is named; unsure on the named field. */
export const restsOn = (field: string | null): Sureness =>
  field === null
    ? { unsure: false, unsureField: null }
    : { unsure: true, unsureField: field };

export type Check = {
  rule: RuleName;
  outcome: CheckOutcome;
  jobValue: unknown;
  profileValue: unknown;
  reason: string;
  detail?: unknown;
} & Sureness;

export type Confidence = 'sure' | 'unsure';

export interface MatchSkill {
  technology: string;
  mastery: number;
  importance: number;
}

export type LanguageLevel = 'native' | 'fluent' | 'working';

/** Where the user may work: per user, the same for each of their profiles. */
export interface MatchEligibility {
  /** `work_authorizations`: kind is work-permit, citizenship, residency or clearance; place a country or region code. */
  authorizations: { kind: string; place: string }[];
  residenceCountry: string | null;
  /** Null (not answered) counts as no. */
  acceptsSponsorship: boolean | null;
}

/** What a LinkedIn post role job adds to the listing rules: the post's verdict, authors and age. */
export interface PostContext {
  verdictConfidence: 'sure' | 'unsure';
  /** Every author of the post and of the posts it reshares: `key` identifies the author, `name` may be empty. */
  authors: { key: string; name: string }[];
  /** Days since the earliest original's date; null when unknown. */
  ageDays: number | null;
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
  /** Minimum pay: all three set, or none. */
  salaryMin: number | null;
  salaryCurrency: string | null;
  salaryPeriod: 'hour' | 'day' | 'month' | 'year' | null;
  acceptsAnyCurrency: boolean;
  acceptedCurrencies: string[];
  /** `contract_types` codes; non-empty. */
  contractTypes: string[];
  /** Spoken languages, ISO 639-1; non-empty. */
  languages: { lang: string; level: LanguageLevel }[];
  eligibility: MatchEligibility;
  /** The author keys the user blocked. */
  blockedAuthors: string[];
  /** Whether the profile searches LinkedIn posts. */
  postSearch: boolean;
  /** No rule reads these: each decision records them, and a row decided before either changed is stale. `profiles.matchVersion`, bumped by triggers on any matching change. */
  matchVersion: number;
  /** `users.eligibilityVersion`, bumped by triggers whenever the eligibility changes. */
  eligibilityVersion: number;
}

export interface MatchJob {
  jobId: string;
  extractionId: string;
  factsHash: string;
  /** From the current extraction; not part of the facts. */
  needsReview: boolean;
  facts: JobFactsDocument;
  /** Null for a listing. */
  post: PostContext | null;
}

const RANK: Record<CheckOutcome, number> = { pass: 2, unknown: 1, fail: 0 };

/** Ranks outcomes for "best of": pass > unknown > fail. */
export function bestOutcome(outcomes: CheckOutcome[]): CheckOutcome {
  let best: CheckOutcome = 'fail';
  for (const o of outcomes) if (RANK[o] > RANK[best]) best = o;
  return best;
}
