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
  const facts: FactScores['facts'] = {};
  const golden: Partial<Record<string, unknown>> = {
    ...c.expected,
    arrangement: reviewedLabel(c, 'arrangement'),
    contractType: reviewedLabel(c, 'contractType'),
    isSoftwareEngineeringRole: reviewedLabel(c, 'isSoftwareEngineeringRole'),
    engagement: reviewedLabel(c, 'engagement'),
  };

  const put = (name: FactName, ok: boolean, f: Envelope) => {
    facts[name] = {
      correct: ok ? 1 : 0,
      total: 1,
      decidedBy: f.decidedBy,
      confidence: f.confidence,
    };
  };

  const scalars: [FactName, Envelope & { value: unknown }][] = [
    ['arrangement', doc.arrangement],
    ['contractType', doc.contractType],
    ['isSoftwareEngineeringRole', doc.isSoftwareEngineeringRole],
    ['engagement', doc.engagement],
    ['seniority', doc.seniority],
    ['yearsRequired', doc.yearsRequired],
    ['contractMonths', doc.contractMonths],
  ];
  for (const [name, fact] of scalars)
    if (golden[name] !== undefined)
      put(name, sameScalar(fact.value, golden[name]), fact);

  if (golden.roleKind !== undefined)
    put(
      'roleKind',
      sameScalar(doc.position.value?.roleKind, golden.roleKind),
      doc.position,
    );

  if (c.expected.openings) {
    const want = placeKeys(c.expected.openings.flatMap((o) => o.places));
    const got = placeKeys(doc.openings.flatMap((o) => o.places));
    facts.openingPlaces = {
      correct: sameSet(want, got) ? 1 : 0,
      total: 1,
      decidedBy: doc.openings[0]?.decidedBy ?? null,
      confidence: doc.openings.every((o) => o.confidence === 'sure')
        ? 'sure'
        : 'unsure',
    };
  }

  if (c.expected.mainStack) {
    const want = c.expected.mainStack.flatMap((g) =>
      g.anyOf.flatMap((t) => (t.code ? [t.code] : [])),
    );
    const got = new Set(
      (doc.techStack.value?.mainStack ?? []).flatMap((g) =>
        g.anyOf.flatMap((t) => (t.code ? [t.code] : [])),
      ),
    );
    if (want.length > 0)
      facts.mainStack = {
        correct: want.filter((t) => got.has(t)).length,
        total: want.length,
        decidedBy: doc.techStack.decidedBy,
        confidence: doc.techStack.confidence,
      };
  }

  if (c.expected.requiredLanguages)
    put(
      'requiredLanguages',
      sameSet(
        c.expected.requiredLanguages.map((l) => l.lang),
        (doc.requiredLanguages.value ?? []).map((l) => l.lang),
      ),
      doc.requiredLanguages,
    );

  if (c.expected.sponsorship !== undefined)
    put(
      'sponsorship',
      sameScalar(
        doc.workAuthorization.value?.sponsorship,
        c.expected.sponsorship,
      ),
      doc.workAuthorization,
    );

  if (c.expected.salary !== undefined)
    put('salary', sameSalary(doc.salary.value, c.expected.salary), doc.salary);

  if (c.expected.junkFlags)
    put(
      'junkFlags',
      sameSet(
        c.expected.junkFlags,
        (doc.junkFlags.value ?? []).map((f) => f.code),
      ),
      doc.junkFlags,
    );

  return {
    caseId: c.id,
    facts,
    jev: scoreJev(doc, golden, extra.jevAnswers),
    costUsd: extra.costUsd ?? 0,
  };
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
  /** Lowest score whose accepted Jev answers are >= 98% correct; null when none. */
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

/** The lowest score whose accepted answers (score at or above it) are 98% correct. */
export function suggestThreshold(
  answers: { score: number; correct: boolean }[],
): { threshold: number | null; accepted: number } {
  const candidates = [...new Set(answers.map((a) => a.score))].sort(
    (a, b) => a - b,
  );
  for (const t of candidates) {
    const accepted = answers.filter((a) => a.score >= t);
    const right = accepted.filter((a) => a.correct).length;
    if (right / accepted.length >= JEV_TARGET_ACCURACY)
      return { threshold: t, accepted: accepted.length };
  }
  return { threshold: null, accepted: 0 };
}

export function summarize(scores: FactScores[]): EvalReport {
  const facts = {} as Record<FactName, FactReport>;
  let sure = 0;
  let sureWrong = 0;
  const wrongCases = new Set<string>();
  for (const name of FACT_NAMES) {
    const entries = scores.flatMap((s) => {
      const e = s.facts[name];
      return e ? [{ e, caseId: s.caseId }] : [];
    });
    const share = (by: DecidedBy) =>
      ratio(
        entries.filter(({ e }) => e.decidedBy === by).length,
        entries.filter(({ e }) => e.decidedBy !== null).length,
      );
    facts[name] = {
      scored: entries.length,
      accuracy: ratio(
        entries.reduce((n, { e }) => n + e.correct, 0),
        entries.reduce((n, { e }) => n + e.total, 0),
      ),
      jevShare: share('jev'),
      opusShare: share('opus'),
      ingestShare: share('ingest'),
    };
    if (name === 'mainStack') continue; // a missed tag is not a contradiction
    for (const { e, caseId } of entries) {
      if (e.confidence !== 'sure') continue;
      sure++;
      if (e.correct < e.total) {
        sureWrong++;
        wrongCases.add(caseId);
      }
    }
  }

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
