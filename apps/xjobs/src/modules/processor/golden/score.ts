import type { DecisionAnswer } from '../models/types';
import type { Confidence, DecidedBy, ExtractionDocument } from '../schema';
import type { GoldenCase, GoldenFacts, GoldenPlace } from './golden';

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

export interface FactScores {
  caseId: string;
  facts: Partial<Record<FactName, FactScore>>;
  jev: Partial<Record<JevQuestion, { score: number; correct: boolean }>>;
  costUsd: number;
}

type Envelope = { decidedBy: DecidedBy; confidence: Confidence };
type DocFact = Envelope & { score: number | null };

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
  extra: { jevAnswers?: DecisionAnswer[]; costUsd?: number } = {},
): FactScores {
  const golden = expectedFacts(c);
  const facts: FactScores['facts'] = {};

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
    jev: scoreJev(doc, golden, extra.jevAnswers),
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
    // Golden years are still a minimum (Task 8 converts them to ranges).
    [
      'yearsRequired',
      { ...doc.yearsRequired, value: doc.yearsRequired.value?.min ?? null },
    ],
    ['contractMonths', doc.contractMonths],
  ];
  for (const [name, fact] of scalars) {
    if (golden[name] === undefined) continue;
    put(facts, name, sameScalar(fact.value, golden[name]), fact);
  }
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

function scoreMainStack(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.mainStack) return;
  const want = c.expected.mainStack.flatMap((group) =>
    group.anyOf.flatMap((term) => (term.code ? [term.code] : [])),
  );
  if (want.length === 0) return;
  // `main` requirements read as the old anyOf groups; only their codes count.
  const got = new Set(
    (doc.techStack.value?.requirements ?? []).flatMap((r) =>
      r.kind === 'main' && r.technology.code ? [r.technology.code] : [],
    ),
  );
  facts.mainStack = {
    correct: want.filter((term) => got.has(term)).length,
    total: want.length,
    decidedBy: doc.techStack.decidedBy,
    confidence: doc.techStack.confidence,
  };
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

/** Jev's own answers (when given), else the ones that stood in the document. */
function scoreJev(
  doc: ExtractionDocument,
  golden: Partial<Record<string, unknown>>,
  answers: DecisionAnswer[] | undefined,
): FactScores['jev'] {
  const fromDoc: Record<JevQuestion, { value: unknown; f: DocFact }> = {
    arrangement: { value: doc.arrangement.value, f: doc.arrangement },
    seniority: { value: doc.seniority.value, f: doc.seniority },
    roleKind: { value: doc.position.value?.roleKind, f: doc.position },
    contractType: { value: doc.contractType.value, f: doc.contractType },
    engagement: { value: doc.engagement.value, f: doc.engagement },
    isSoftwareEngineeringRole: {
      value: doc.isSoftwareEngineeringRole.value,
      f: doc.isSoftwareEngineeringRole,
    },
    sponsorshipOffered: {
      value: doc.workAuthorization.value?.sponsorship,
      f: doc.workAuthorization,
    },
  };
  const out: FactScores['jev'] = {};
  for (const q of Object.keys(JEV_QUESTIONS) as JevQuestion[]) {
    const want = golden[JEV_QUESTIONS[q]];
    if (want === undefined) continue;
    if (answers) {
      const answer = answers.find((a) => a.key === q);
      if (answer && answer.value !== null)
        out[q] = {
          score: answer.score,
          correct: sameScalar(answer.value, want),
        };
    } else {
      const { value, f } = fromDoc[q];
      if (f.decidedBy === 'jev' && f.score !== null)
        out[q] = { score: f.score, correct: sameScalar(value, want) };
    }
  }
  return out;
}

export interface FactReport {
  /** Cases with a golden value for this fact. */
  scored: number;
  /** Null when no case is scored. */
  accuracy: number | null;
  jevShare: number | null;
  opusShare: number | null;
  ingestShare: number | null;
}

export interface QuestionReport {
  buckets: {
    range: string;
    total: number;
    correct: number;
    accuracy: number | null;
  }[];
  /**
   * Lowest score whose accepted Jev answers (at least
   * `MIN_ACCEPTED_FOR_THRESHOLD`) are >= 98% correct; null when none.
   */
  suggestedThreshold: number | null;
  /** Jev answers at or above the suggested threshold. */
  acceptedAtSuggested: number;
}

export interface EvalReport {
  cases: number;
  facts: Record<FactName, FactReport>;
  questions: Record<JevQuestion, QuestionReport>;
  /** Share of `sure` facts (mainStack aside) the golden value contradicts. */
  sureContradicted: number;
  sureFacts: number;
  casesWithSureContradiction: number;
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

  const questions = {} as Record<JevQuestion, QuestionReport>;
  for (const q of Object.keys(JEV_QUESTIONS) as JevQuestion[]) {
    const answers = scores.flatMap((s) => {
      const a = s.jev[q];
      return a ? [a] : [];
    });
    const { threshold, accepted } = suggestThreshold(answers);
    questions[q] = {
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

  const sureContradicted = sure === 0 ? 0 : sureWrong / sure;
  const bars = {
    openingPlaces: (facts.openingPlaces.accuracy ?? 0) >= BARS.openingPlaces,
    arrangement: (facts.arrangement.accuracy ?? 0) >= BARS.arrangement,
    mainStack: (facts.mainStack.accuracy ?? 0) >= BARS.mainStack,
    sureContradicted: sureContradicted <= BARS.sureContradicted,
  };
  return {
    cases: scores.length,
    facts,
    questions,
    sureContradicted,
    sureFacts: sure,
    casesWithSureContradiction: wrongCases.size,
    costPerJob:
      scores.length === 0
        ? 0
        : scores.reduce((n, s) => n + s.costUsd, 0) / scores.length,
    bars,
    pass: Object.values(bars).every(Boolean),
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
  const decided = entries.filter(({ e }) => e.decidedBy !== null);
  const share = (by: DecidedBy) =>
    ratio(decided.filter(({ e }) => e.decidedBy === by).length, decided.length);
  return {
    scored: entries.length,
    accuracy: ratio(
      entries.reduce((total, { e }) => total + e.correct, 0),
      entries.reduce((total, { e }) => total + e.total, 0),
    ),
    jevShare: share('jev'),
    opusShare: share('opus'),
    ingestShare: share('ingest'),
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

/** One eval CLI line: a question's buckets, suggested threshold and accepted count. */
export function questionLine(q: string, r: QuestionReport): string {
  const buckets = r.buckets
    .map((b) => `${b.range} ${b.correct}/${b.total}`)
    .join('  ');
  return `${q.padEnd(26)} ${buckets}  -> ${r.suggestedThreshold ?? 'none'} (accepted ${r.acceptedAtSuggested})`;
}
