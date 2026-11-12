import type { NewAttempt } from '../repositories/processor.repository';
import { comparablePick, type FieldVerdict } from '../rules/verify';
import type { Confidence, DecidedBy, ExtractionDocument } from '../schema';
import type { Verdict, Verification } from '../schema/fact';
import type {
  GoldenCase,
  GoldenFacts,
  GoldenPlace,
  GoldenRange,
} from './golden';

export const FACT_NAMES = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
  'engagement',
  'roleKind',
  'seniority',
  'yearsRequired',
  'contractMonths',
  'openingPlaces',
  'mainStack',
  'requiredLanguages',
  'sponsorship',
  'salary',
  'junkFlags',
] as const;
export type FactName = (typeof FACT_NAMES)[number];

/** The closed questions Jev answers, and the fact each one decides. */
export const JEV_QUESTIONS = {
  arrangement: 'arrangement',
  seniority: 'seniority',
  roleKind: 'roleKind',
  contractType: 'contractType',
  engagement: 'engagement',
  isSoftwareEngineeringRole: 'isSoftwareEngineeringRole',
  sponsorshipOffered: 'sponsorship',
} as const satisfies Record<string, FactName>;
export type JevQuestion = keyof typeof JEV_QUESTIONS;

export const BUCKETS = [
  { range: '0–0.5', from: 0, to: 0.5 },
  { range: '0.5–0.7', from: 0.5, to: 0.7 },
  { range: '0.7–0.8', from: 0.7, to: 0.8 },
  { range: '0.8–0.9', from: 0.8, to: 0.9 },
  { range: '0.9–1', from: 0.9, to: Infinity },
] as const;

/** The closed fields Jev verifies: its questions, and the junk flags. */
export const VERIFIED_FIELDS = [
  ...(Object.keys(JEV_QUESTIONS) as JevQuestion[]),
  'junkFlags',
] as const;
export type VerifiedField = (typeof VERIFIED_FIELDS)[number];

/** Jev's accepted answers must be at least this share correct. */
export const JEV_TARGET_ACCURACY = 0.98;
/** Fewer accepted answers than this are too few to suggest a threshold from. */
export const MIN_ACCEPTED_FOR_THRESHOLD = 10;

/** Acceptance bars for v1 (spec section 8). */
export const BARS = {
  openingPlaces: 0.95,
  arrangement: 0.97,
  mainStack: 0.9,
  sureContradicted: 0.02,
} as const;

interface FactScore {
  /** Right parts out of `total` (1 of 1 for most facts; tags found for mainStack). */
  correct: number;
  total: number;
  decidedBy: DecidedBy | null;
  confidence: Confidence | null;
}

/** One answer of Jev's: its score, whether golden agrees, and whether it confirmed the generator. */
export interface JevAnswerScore {
  score: number;
  correct: boolean;
  agrees: boolean;
}

/** Per-case counts behind the requirement scores; summed over the run. */
export interface RequirementCounts {
  requiredHit: number;
  requiredWant: number;
  requiredGot: number;
  niceHit: number;
  niceWant: number;
  niceGot: number;
  kindRight: number;
  kindTotal: number;
  domainRight: number;
  domainTotal: number;
  yearsRight: number;
  yearsTotal: number;
}

export interface FactScores {
  caseId: string;
  facts: Partial<Record<FactName, FactScore>>;
  jev: Partial<Record<JevQuestion, JevAnswerScore>>;
  /** Jev's `junk:*` answers from every round (they share one threshold). */
  junkAnswers: JevAnswerScore[];
  /** Jev's final verdict per closed field it verified. */
  verdicts: Partial<Record<VerifiedField, Verdict>>;
  /** Each final rejection with a golden value: was the generator's value wrong? */
  rejections: Rejection[];
  /** The same for every rejection in every round, fixed later or not. */
  rejectionsAllRounds: Rejection[];
  requirements: RequirementCounts | null;
  rounds: number;
  generatorCalls: number;
  verifierCalls: number;
  costUsd: number;
}

export interface Rejection {
  field: string;
  wrong: boolean;
}

/** What one job's attempt rows add up to. */
export interface CallStats {
  generatorCalls: number;
  verifierCalls: number;
  costUsd: number;
}

const GENERATOR_STEPS: ReadonlySet<NewAttempt['step']> = new Set([
  'generation',
  'generation_retry',
]);

/** Generator and Jev calls, and their cost, from a job's attempt rows. */
export function callStats(
  rows: readonly Pick<NewAttempt, 'step' | 'costUsd'>[],
): CallStats {
  return {
    generatorCalls: rows.filter((r) => GENERATOR_STEPS.has(r.step)).length,
    verifierCalls: rows.filter((r) => r.step === 'verification').length,
    costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

type Envelope = { decidedBy: DecidedBy; confidence: Confidence };
type Verified = { verification: Verification | null };

const isUnstated = (v: unknown): boolean =>
  v === null || v === undefined || v === 'unstated';
const sameScalar = (a: unknown, b: unknown): boolean =>
  isUnstated(a) && isUnstated(b) ? true : a === b;
const sameSet = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Countries, regions and worldwide; a city counts as its country. */
function placeKeys(places: readonly GoldenPlace[]): string[] {
  return places.flatMap((p): string[] => {
    if (p.kind === 'worldwide') return ['worldwide'];
    if (p.kind === 'region')
      return [p.code === 'GLOBAL' ? 'worldwide' : `region:${p.code}`];
    if (p.kind === 'country') return [`country:${p.code}`];
    return p.countryCode ? [`country:${p.countryCode}`] : [];
  });
}

/** A range with neither bound reads as no range. */
const sameRange = (
  a: GoldenRange | null | undefined,
  b: GoldenRange | null | undefined,
): boolean => {
  const norm = (r: GoldenRange | null | undefined) =>
    r && (r.min !== null || r.max !== null) ? r : null;
  const x = norm(a);
  const y = norm(b);
  return x === null || y === null
    ? x === y
    : x.min === y.min && x.max === y.max;
};

const sameSalary = (
  a: GoldenFacts['salary'],
  b: GoldenFacts['salary'],
): boolean =>
  a === null || b === null
    ? a === b
    : a.min === b.min &&
      a.max === b.max &&
      a.currency === b.currency &&
      a.period === b.period;

/** A drafted label counts only when a human reviewed it. */
function reviewedLabel(c: GoldenCase, key: keyof GoldenCase['drafted']) {
  const d = c.drafted[key];
  return d?.reviewed ? d.value : undefined;
}

export function scoreCase(
  doc: ExtractionDocument,
  c: GoldenCase,
  extra: Partial<CallStats> & {
    /** What each verification round returned, in order (the eval records them). */
    roundVerdicts?: FieldVerdict[][];
  } = {},
): FactScores {
  const golden = expectedFacts(c);
  const facts: FactScores['facts'] = {};
  const roundVerdicts = (extra.roundVerdicts ?? []).flat();

  scoreScalars(doc, golden, facts);
  scoreRoleKind(doc, golden, facts);
  scoreOpeningPlaces(doc, c, facts);
  scoreMainStack(doc, c, facts);
  scoreRequiredLanguages(doc, c, facts);
  scoreSponsorship(doc, c, facts);
  scoreSalary(doc, c, facts);
  scoreJunkFlags(doc, c, facts);

  return {
    caseId: c.id,
    facts,
    jev: scoreJev(doc, golden),
    junkAnswers: scoreJunkAnswers(roundVerdicts, golden),
    verdicts: verdictsOf(doc),
    rejections: scoreRejections(doc, golden),
    rejectionsAllRounds: scoreRoundRejections(roundVerdicts, golden),
    requirements: scoreRequirements(doc, c),
    rounds: doc.verification.rounds,
    generatorCalls: extra.generatorCalls ?? 0,
    verifierCalls: extra.verifierCalls ?? 0,
    costUsd: extra.costUsd ?? 0,
  };
}

function expectedFacts(c: GoldenCase): Partial<Record<string, unknown>> {
  return {
    ...c.expected,
    arrangement: reviewedLabel(c, 'arrangement'),
    contractType: reviewedLabel(c, 'contractType'),
    isSoftwareEngineeringRole: reviewedLabel(c, 'isSoftwareEngineeringRole'),
    engagement: reviewedLabel(c, 'engagement'),
  };
}

function put(
  facts: FactScores['facts'],
  name: FactName,
  ok: boolean,
  fact: Envelope,
): void {
  facts[name] = {
    correct: ok ? 1 : 0,
    total: 1,
    decidedBy: fact.decidedBy,
    confidence: fact.confidence,
  };
}

function scoreScalars(
  doc: ExtractionDocument,
  golden: Partial<Record<string, unknown>>,
  facts: FactScores['facts'],
): void {
  const scalars: [FactName, Envelope & { value: unknown }][] = [
    ['arrangement', doc.arrangement],
    ['contractType', doc.contractType],
    ['isSoftwareEngineeringRole', doc.isSoftwareEngineeringRole],
    ['engagement', doc.engagement],
    ['seniority', doc.seniority],
    ['contractMonths', doc.contractMonths],
  ];
  for (const [name, fact] of scalars) {
    if (golden[name] === undefined) continue;
    put(facts, name, sameScalar(fact.value, golden[name]), fact);
  }
  if (golden.yearsRequired !== undefined)
    put(
      facts,
      'yearsRequired',
      sameRange(
        doc.yearsRequired.value,
        golden.yearsRequired as GoldenRange | null,
      ),
      doc.yearsRequired,
    );
}

function scoreRoleKind(
  doc: ExtractionDocument,
  golden: Partial<Record<string, unknown>>,
  facts: FactScores['facts'],
): void {
  if (golden.roleKind === undefined) return;
  put(
    facts,
    'roleKind',
    sameScalar(doc.position.value?.roleKind, golden.roleKind),
    doc.position,
  );
}

function scoreOpeningPlaces(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.openings) return;
  const want = placeKeys(
    c.expected.openings.flatMap((opening) => opening.places),
  );
  const got = placeKeys(doc.openings.flatMap((opening) => opening.places));
  facts.openingPlaces = {
    correct: sameSet(want, got) ? 1 : 0,
    total: 1,
    decidedBy: doc.openings[0]?.decidedBy ?? null,
    confidence:
      doc.openings.length > 0 &&
      doc.openings.every((opening) => opening.confidence === 'sure')
        ? 'sure'
        : 'unsure',
  };
}

/** Golden `main` technologies the document also lists as `main`. */
function scoreMainStack(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.requirements) return;
  const want = codesOf(c.expected.requirements, ['main']);
  if (want.size === 0) return;
  const got = codesOf(docRequirements(doc), ['main']);
  facts.mainStack = {
    correct: [...want].filter((code) => got.has(code)).length,
    total: want.size,
    decidedBy: doc.techStack.decidedBy,
    confidence: doc.techStack.confidence,
  };
}

type Kind = 'main' | 'must' | 'nice';
type CodedRequirement = {
  code: string | null;
  kind: Kind;
  domain: string | null;
  years: GoldenRange | null;
};

const docRequirements = (doc: ExtractionDocument): CodedRequirement[] =>
  (doc.techStack.value?.requirements ?? []).map((r) => ({
    code: r.technology.code,
    kind: r.kind,
    domain: r.domain,
    years: r.years,
  }));

const codesOf = (
  requirements: readonly CodedRequirement[],
  kinds: readonly Kind[],
): Set<string> =>
  new Set(
    requirements.flatMap((r) =>
      r.code !== null && kinds.includes(r.kind) ? [r.code] : [],
    ),
  );

const overlap = (a: Set<string>, b: Set<string>): number =>
  [...a].filter((code) => b.has(code)).length;

/**
 * Technology recall and precision on required (main + must) and on nice, by
 * code; kind on the technologies both list; domain and years only once a
 * human has labeled them (`drafted.requirements` reviewed).
 */
function scoreRequirements(
  doc: ExtractionDocument,
  c: GoldenCase,
): RequirementCounts | null {
  const golden = c.expected.requirements;
  if (!golden) return null;
  const got = docRequirements(doc);
  const required: Kind[] = ['main', 'must'];
  const wantRequired = codesOf(golden, required);
  const gotRequired = codesOf(got, required);
  const wantNice = codesOf(golden, ['nice']);
  const gotNice = codesOf(got, ['nice']);
  const labeled = c.drafted.requirements?.reviewed ?? true;
  const counts: RequirementCounts = {
    requiredHit: overlap(wantRequired, gotRequired),
    requiredWant: wantRequired.size,
    requiredGot: gotRequired.size,
    niceHit: overlap(wantNice, gotNice),
    niceWant: wantNice.size,
    niceGot: gotNice.size,
    kindRight: 0,
    kindTotal: 0,
    domainRight: 0,
    domainTotal: 0,
    yearsRight: 0,
    yearsTotal: 0,
  };
  const seen = new Set<string>();
  for (const want of golden) {
    if (want.code === null || seen.has(want.code)) continue;
    seen.add(want.code);
    const match = got.filter((r) => r.code === want.code);
    if (match.length === 0) continue;
    counts.kindTotal++;
    if (match.some((r) => r.kind === want.kind)) counts.kindRight++;
    if (!labeled) continue;
    counts.domainTotal++;
    if (match.some((r) => r.domain === want.domain)) counts.domainRight++;
    counts.yearsTotal++;
    if (match.some((r) => sameRange(r.years, want.years))) counts.yearsRight++;
  }
  return counts;
}

function scoreRequiredLanguages(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.requiredLanguages) return;
  put(
    facts,
    'requiredLanguages',
    sameSet(
      c.expected.requiredLanguages.map((language) => language.lang),
      (doc.requiredLanguages.value ?? []).map((language) => language.lang),
    ),
    doc.requiredLanguages,
  );
}

function scoreSponsorship(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (c.expected.sponsorship === undefined) return;
  put(
    facts,
    'sponsorship',
    sameScalar(
      doc.workAuthorization.value?.sponsorship,
      c.expected.sponsorship,
    ),
    doc.workAuthorization,
  );
}

function scoreSalary(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (c.expected.salary === undefined) return;
  put(
    facts,
    'salary',
    sameSalary(doc.salary.value, c.expected.salary),
    doc.salary,
  );
}

function scoreJunkFlags(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.junkFlags) return;
  put(
    facts,
    'junkFlags',
    sameSet(
      c.expected.junkFlags,
      (doc.junkFlags.value ?? []).map((flag) => flag.code),
    ),
    doc.junkFlags,
  );
}

const yesNo = (v: unknown): unknown =>
  typeof v === 'boolean' ? (v ? 'yes' : 'no') : v;

/** Each verified fact's envelope, and the generator's value as a Jev option. */
function verifiedFacts(
  doc: ExtractionDocument,
): Record<JevQuestion, { pick: unknown; f: Verified }> {
  return {
    arrangement: { pick: doc.arrangement.value, f: doc.arrangement },
    seniority: { pick: doc.seniority.value, f: doc.seniority },
    roleKind: { pick: doc.position.value?.roleKind, f: doc.position },
    contractType: { pick: doc.contractType.value, f: doc.contractType },
    engagement: { pick: doc.engagement.value, f: doc.engagement },
    isSoftwareEngineeringRole: {
      pick: yesNo(doc.isSoftwareEngineeringRole.value),
      f: doc.isSoftwareEngineeringRole,
    },
    sponsorshipOffered: {
      pick: doc.workAuthorization.value?.sponsorship,
      f: doc.workAuthorization,
    },
  };
}

/** The golden value of a verified field, as a Jev option; undefined when unlabeled. */
function goldenPick(
  golden: Partial<Record<string, unknown>>,
  field: string,
): unknown {
  if (field.startsWith('junk:')) {
    const flags = golden.junkFlags as string[] | undefined;
    return (
      flags && (flags.includes(field.slice('junk:'.length)) ? 'yes' : 'no')
    );
  }
  const fact = JEV_QUESTIONS[field as JevQuestion];
  return fact === undefined ? undefined : yesNo(golden[fact]);
}

/**
 * Jev's final answer per question, from each fact's verification. An answer
 * `agrees` when it confirmed the generator's value (or would have, at a
 * lower threshold): the answers a threshold is set from.
 */
function scoreJev(
  doc: ExtractionDocument,
  golden: Partial<Record<string, unknown>>,
): FactScores['jev'] {
  const out: FactScores['jev'] = {};
  for (const [q, { pick, f }] of Object.entries(verifiedFacts(doc)) as [
    JevQuestion,
    { pick: unknown; f: Verified },
  ][]) {
    const want = goldenPick(golden, q);
    const v = f.verification;
    if (want === undefined || !v || v.score === null || v.jevPick === null)
      continue;
    out[q] = {
      score: v.score,
      correct: sameScalar(v.jevPick, want),
      agrees:
        v.verdict === 'confirmed' ||
        (v.verdict === 'unconfirmed' && sameScalar(v.jevPick, pick)),
    };
  }
  return out;
}

/** Every round's junk answers; `agrees` when Jev picked the generator's value. */
function scoreJunkAnswers(
  verdicts: FieldVerdict[],
  golden: Partial<Record<string, unknown>>,
): JevAnswerScore[] {
  return verdicts.flatMap((v) => {
    const want = goldenPick(golden, v.key);
    if (
      !v.key.startsWith('junk:') ||
      want === undefined ||
      v.score === null ||
      v.jevPick === null
    )
      return [];
    // Compared as the pipeline compares it: `unstated` on a flag is `no`.
    const pick = comparablePick(v.key, v.jevPick);
    return [
      {
        score: v.score,
        correct: sameScalar(pick, want),
        agrees: pick === v.generatorValue,
      },
    ];
  });
}

/** Every rejection of every round, judged against golden. */
function scoreRoundRejections(
  verdicts: FieldVerdict[],
  golden: Partial<Record<string, unknown>>,
): Rejection[] {
  return verdicts.flatMap((v) => {
    const want = goldenPick(golden, v.key);
    return v.verdict !== 'rejected' || want === undefined
      ? []
      : [{ field: v.key, wrong: !sameScalar(v.generatorValue, want) }];
  });
}

function verdictsOf(doc: ExtractionDocument): FactScores['verdicts'] {
  const out: FactScores['verdicts'] = {};
  for (const [q, { f }] of Object.entries(verifiedFacts(doc)) as [
    JevQuestion,
    { f: Verified },
  ][])
    if (f.verification) out[q] = f.verification.verdict;
  if (doc.junkFlags.verification)
    out.junkFlags = doc.junkFlags.verification.verdict;
  return out;
}

/**
 * The generator values Jev finally rejected (the dropped fields, and junk
 * flags Jev saw that the generator did not), judged against golden.
 */
function scoreRejections(
  doc: ExtractionDocument,
  golden: Partial<Record<string, unknown>>,
): FactScores['rejections'] {
  const rejected = [
    ...doc.verification.dropped.map((d) => ({
      field: d.field,
      value: d.generatorValue,
    })),
    ...doc.verification.missedJunkFlags.map((code) => ({
      field: `junk:${code}`,
      value: 'no',
    })),
  ];
  return rejected.flatMap(({ field, value }) => {
    const want = goldenPick(golden, field);
    return want === undefined
      ? []
      : [{ field, wrong: !sameScalar(yesNo(value), want) }];
  });
}

export interface FactReport {
  /** Cases with a golden value for this fact. */
  scored: number;
  /** Null when no case is scored. */
  accuracy: number | null;
}

/** Jev's final verdicts on one closed field, as shares of the `verified` cases. */
export interface VerdictReport {
  verified: number;
  confirmed: number | null;
  unconfirmed: number | null;
  rejected: number | null;
}

/** Null where nothing was there to count. */
export interface RequirementReport {
  requiredRecall: number | null;
  requiredPrecision: number | null;
  niceRecall: number | null;
  nicePrecision: number | null;
  kindAccuracy: number | null;
  domainAccuracy: number | null;
  yearsAccuracy: number | null;
}

export interface QuestionReport {
  buckets: {
    range: string;
    total: number;
    correct: number;
    accuracy: number | null;
  }[];
  /**
   * Lowest score whose confirmations (at least `MIN_ACCEPTED_FOR_THRESHOLD`)
   * are >= 98% correct; null when none.
   */
  suggestedThreshold: number | null;
  /** Confirmations at or above the suggested threshold. */
  acceptedAtSuggested: number;
}

export interface EvalReport {
  cases: number;
  facts: Record<FactName, FactReport>;
  /** Per question, plus `junk` for every `junk:*` answer (one threshold). */
  questions: Record<JevQuestion | 'junk', QuestionReport>;
  verdicts: Record<VerifiedField, VerdictReport>;
  /** Final rejections with a golden value. */
  rejections: number;
  /** Of those, the share whose generator value golden says was wrong. */
  rejectionPrecision: number | null;
  /** Rejections with a golden value in every round, fixed later or not. */
  rejectionsAllRounds: number;
  rejectionPrecisionAllRounds: number | null;
  requirements: RequirementReport;
  /** Share of `sure` facts (mainStack aside) the golden value contradicts. */
  sureContradicted: number;
  sureFacts: number;
  casesWithSureContradiction: number;
  roundsPerJob: number;
  generatorCallsPerJob: number;
  verifierCallsPerJob: number;
  costPerJob: number;
  bars: Record<keyof typeof BARS, boolean>;
  pass: boolean;
}

const ratio = (num: number, den: number): number | null =>
  den === 0 ? null : num / den;

/**
 * The lowest score whose accepted answers (score at or above it) are 98%
 * correct, and at least `MIN_ACCEPTED_FOR_THRESHOLD` of them.
 */
export function suggestThreshold(
  answers: { score: number; correct: boolean }[],
): { threshold: number | null; accepted: number } {
  const candidates = [...new Set(answers.map((a) => a.score))].sort(
    (a, b) => a - b,
  );
  for (const t of candidates) {
    const accepted = answers.filter((a) => a.score >= t);
    // Higher thresholds only accept fewer answers.
    if (accepted.length < MIN_ACCEPTED_FOR_THRESHOLD) break;
    const right = accepted.filter((a) => a.correct).length;
    if (right / accepted.length >= JEV_TARGET_ACCURACY)
      return { threshold: t, accepted: accepted.length };
  }
  return { threshold: null, accepted: 0 };
}

export function summarize(scores: FactScores[]): EvalReport {
  const summary = summarizeFacts(scores);
  const { facts, sure, sureWrong, wrongCases } = summary;

  const questions = {} as Record<JevQuestion | 'junk', QuestionReport>;
  for (const q of Object.keys(JEV_QUESTIONS) as JevQuestion[])
    questions[q] = questionReport(
      scores.flatMap((s) => {
        const a = s.jev[q];
        return a ? [a] : [];
      }),
    );
  questions.junk = questionReport(scores.flatMap((s) => s.junkAnswers));

  const sureContradicted = sure === 0 ? 0 : sureWrong / sure;
  const bars = {
    openingPlaces: (facts.openingPlaces.accuracy ?? 0) >= BARS.openingPlaces,
    arrangement: (facts.arrangement.accuracy ?? 0) >= BARS.arrangement,
    mainStack: (facts.mainStack.accuracy ?? 0) >= BARS.mainStack,
    sureContradicted: sureContradicted <= BARS.sureContradicted,
  };
  const rejections = scores.flatMap((s) => s.rejections);
  const allRounds = scores.flatMap((s) => s.rejectionsAllRounds);
  const perJob = (pick: (s: FactScores) => number): number =>
    scores.length === 0
      ? 0
      : scores.reduce((n, s) => n + pick(s), 0) / scores.length;
  return {
    cases: scores.length,
    facts,
    questions,
    verdicts: summarizeVerdicts(scores),
    rejections: rejections.length,
    rejectionPrecision: ratio(
      rejections.filter((r) => r.wrong).length,
      rejections.length,
    ),
    rejectionsAllRounds: allRounds.length,
    rejectionPrecisionAllRounds: ratio(
      allRounds.filter((r) => r.wrong).length,
      allRounds.length,
    ),
    requirements: summarizeRequirements(scores),
    sureContradicted,
    sureFacts: sure,
    casesWithSureContradiction: wrongCases.size,
    roundsPerJob: perJob((s) => s.rounds),
    generatorCallsPerJob: perJob((s) => s.generatorCalls),
    verifierCallsPerJob: perJob((s) => s.verifierCalls),
    costPerJob: perJob((s) => s.costUsd),
    bars,
    pass: Object.values(bars).every(Boolean),
  };
}

/** Accuracy by score bucket over all answers; the threshold from confirmations only. */
function questionReport(answers: JevAnswerScore[]): QuestionReport {
  const { threshold, accepted } = suggestThreshold(
    answers.filter((a) => a.agrees),
  );
  return {
    buckets: BUCKETS.map((b) => {
      const inBucket = answers.filter(
        (a) => a.score >= b.from && a.score < b.to,
      );
      const correct = inBucket.filter((a) => a.correct).length;
      return {
        range: b.range,
        total: inBucket.length,
        correct,
        accuracy: ratio(correct, inBucket.length),
      };
    }),
    suggestedThreshold: threshold,
    acceptedAtSuggested: accepted,
  };
}

function summarizeVerdicts(
  scores: FactScores[],
): Record<VerifiedField, VerdictReport> {
  const out = {} as Record<VerifiedField, VerdictReport>;
  for (const field of VERIFIED_FIELDS) {
    const verdicts = scores.flatMap((s) => {
      const v = s.verdicts[field];
      return v ? [v] : [];
    });
    const share = (v: Verdict) =>
      ratio(verdicts.filter((x) => x === v).length, verdicts.length);
    out[field] = {
      verified: verdicts.length,
      confirmed: share('confirmed'),
      unconfirmed: share('unconfirmed'),
      rejected: share('rejected'),
    };
  }
  return out;
}

function summarizeRequirements(scores: FactScores[]): RequirementReport {
  const sum = (key: keyof RequirementCounts): number =>
    scores.reduce((n, s) => n + (s.requirements?.[key] ?? 0), 0);
  return {
    requiredRecall: ratio(sum('requiredHit'), sum('requiredWant')),
    requiredPrecision: ratio(sum('requiredHit'), sum('requiredGot')),
    niceRecall: ratio(sum('niceHit'), sum('niceWant')),
    nicePrecision: ratio(sum('niceHit'), sum('niceGot')),
    kindAccuracy: ratio(sum('kindRight'), sum('kindTotal')),
    domainAccuracy: ratio(sum('domainRight'), sum('domainTotal')),
    yearsAccuracy: ratio(sum('yearsRight'), sum('yearsTotal')),
  };
}

type ScoredEntry = { e: FactScore; caseId: string };

function summarizeFacts(scores: FactScores[]): {
  facts: Record<FactName, FactReport>;
  sure: number;
  sureWrong: number;
  wrongCases: Set<string>;
} {
  const facts = {} as Record<FactName, FactReport>;
  let sure = 0;
  let sureWrong = 0;
  const wrongCases = new Set<string>();

  for (const name of FACT_NAMES) {
    const entries = scores.flatMap((score): ScoredEntry[] => {
      const fact = score.facts[name];
      return fact ? [{ e: fact, caseId: score.caseId }] : [];
    });
    facts[name] = summarizeFact(entries);
    if (name === 'mainStack') continue;

    const contradictions = sureContradictions(entries);
    sure += contradictions.total;
    sureWrong += contradictions.wrong;
    for (const caseId of contradictions.cases) wrongCases.add(caseId);
  }

  return { facts, sure, sureWrong, wrongCases };
}

function summarizeFact(entries: ScoredEntry[]): FactReport {
  return {
    scored: entries.length,
    accuracy: ratio(
      entries.reduce((total, { e }) => total + e.correct, 0),
      entries.reduce((total, { e }) => total + e.total, 0),
    ),
  };
}

function sureContradictions(entries: ScoredEntry[]): {
  total: number;
  wrong: number;
  cases: string[];
} {
  const sure = entries.filter(({ e }) => e.confidence === 'sure');
  const wrong = sure.filter(({ e }) => e.correct < e.total);
  return {
    total: sure.length,
    wrong: wrong.length,
    cases: wrong.map(({ caseId }) => caseId),
  };
}

/** One eval CLI line: a question's buckets, suggested threshold and confirmations accepted. */
export function questionLine(q: string, r: QuestionReport): string {
  const buckets = r.buckets
    .map((b) => `${b.range} ${b.correct}/${b.total}`)
    .join('  ');
  return `${q.padEnd(26)} ${buckets}  -> ${r.suggestedThreshold ?? 'none'} (accepted ${r.acceptedAtSuggested})`;
}

/** Where `processor:eval` writes the report of a run with `generator`, next to `cases/`. */
export function reportFileName(generator: string): string {
  const slug = generator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `last-report.${slug}.json`;
}
