import type { NewAttempt } from '../repositories/processor.repository';
import type { Confidence, DecidedBy, ExtractionDocument } from '../schema';
import type {
  DraftedKey,
  GoldenCase,
  GoldenFacts,
  GoldenPlace,
  GoldenRange,
} from './golden';

export const FACT_NAMES = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
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
  /** The golden value and the document's, as compared, to read a miss. */
  want: unknown;
  got: unknown;
  /** The document's quote for the fact; empty when it has none. */
  quote: string;
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

/** Required (main + must) technology codes one case missed or added. */
export interface RequiredDiff {
  missing: string[];
  extra: string[];
}

/**
 * An unreviewed draft next to the document's answer, so agreements can be
 * confirmed and disagreements reviewed. `agrees` is null for `requirements`,
 * which a human always reads (their domain and years have no label yet).
 */
export interface DraftCheck {
  label: unknown;
  got: unknown;
  quote: string;
  confidence: Confidence | null;
  agrees: boolean | null;
}

export interface FactScores {
  caseId: string;
  facts: Partial<Record<FactName, FactScore>>;
  /** Unscored: one entry per drafted key still `reviewed: false`. */
  drafts: Partial<Record<DraftedKey, DraftCheck>>;
  requirements: RequirementCounts | null;
  required: RequiredDiff | null;
  generatorCalls: number;
  costUsd: number;
}

/** One wrong fact in one case, to tell a model miss from a wrong label. */
export interface EvalMiss {
  caseId: string;
  title: string;
  fact: string;
  confidence: string | null;
  want: unknown;
  got: unknown;
  quote: string;
}

/** What `processor:eval` writes for the listing set (`reportFileName`). */
export interface ListingReportFile extends EvalReport {
  failed: string[];
  stoppedOnLimit: unknown;
  notRun: string[];
  config: unknown;
  misses: EvalMiss[];
  scores: FactScores[];
}

/** What one job's attempt rows add up to. */
export interface CallStats {
  generatorCalls: number;
  costUsd: number;
}

const GENERATOR_STEPS: ReadonlySet<NewAttempt['step']> = new Set([
  'generation',
  'generation_retry',
]);

/** Generator calls, and their cost, from a job's attempt rows. */
export function callStats(
  rows: readonly Pick<NewAttempt, 'step' | 'costUsd'>[],
): CallStats {
  return {
    generatorCalls: rows.filter((r) => GENERATOR_STEPS.has(r.step)).length,
    costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

type Envelope = {
  decidedBy: DecidedBy;
  confidence: Confidence;
  quote?: string;
};

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
  extra: Partial<CallStats> = {},
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
    drafts: draftChecks(doc, c),
    requirements: scoreRequirements(doc, c),
    required: requiredDiff(doc, c),
    generatorCalls: extra.generatorCalls ?? 0,
    costUsd: extra.costUsd ?? 0,
  };
}

const LABEL_FACTS = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
] as const;

function draftChecks(
  doc: ExtractionDocument,
  c: GoldenCase,
): FactScores['drafts'] {
  const drafts: FactScores['drafts'] = {};
  for (const key of LABEL_FACTS) {
    const d = c.drafted[key];
    if (!d || d.reviewed) continue;
    const fact = doc[key];
    drafts[key] = {
      label: d.value,
      got: fact.value,
      quote: fact.quote ?? '',
      confidence: fact.confidence,
      agrees: sameScalar(fact.value, d.value),
    };
  }
  if (c.drafted.requirements && !c.drafted.requirements.reviewed)
    drafts.requirements = {
      label: c.expected.requirements ?? null,
      got: (doc.techStack.value?.requirements ?? []).map((r) => ({
        text: r.technology.text,
        code: r.technology.code,
        kind: r.kind,
        domain: r.domain,
        years: r.years,
      })),
      quote: '',
      confidence: doc.techStack.confidence,
      agrees: null,
    };
  return drafts;
}

function expectedFacts(c: GoldenCase): Partial<Record<string, unknown>> {
  return {
    ...c.expected,
    arrangement: reviewedLabel(c, 'arrangement'),
    contractType: reviewedLabel(c, 'contractType'),
    isSoftwareEngineeringRole: reviewedLabel(c, 'isSoftwareEngineeringRole'),
  };
}

function put(
  facts: FactScores['facts'],
  name: FactName,
  ok: boolean,
  fact: Envelope,
  want: unknown,
  got: unknown,
): void {
  facts[name] = {
    correct: ok ? 1 : 0,
    total: 1,
    decidedBy: fact.decidedBy,
    confidence: fact.confidence,
    want,
    got,
    quote: fact.quote ?? '',
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
    ['seniority', doc.seniority],
    ['contractMonths', doc.contractMonths],
  ];
  for (const [name, fact] of scalars) {
    if (golden[name] === undefined) continue;
    put(
      facts,
      name,
      sameScalar(fact.value, golden[name]),
      fact,
      golden[name],
      fact.value,
    );
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
      golden.yearsRequired,
      doc.yearsRequired.value,
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
    golden.roleKind,
    doc.position.value?.roleKind ?? null,
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
    want: [...new Set(want)].sort(),
    got: [...new Set(got)].sort(),
    quote: doc.openings.map((opening) => opening.quote).join(' | '),
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
    want: [...want].sort(),
    got: [...got].sort(),
    quote: '',
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

/** Required codes the golden case lists and the document doesn't, and back. */
function requiredDiff(
  doc: ExtractionDocument,
  c: GoldenCase,
): RequiredDiff | null {
  if (!c.expected.requirements) return null;
  const want = codesOf(c.expected.requirements, ['main', 'must']);
  const got = codesOf(docRequirements(doc), ['main', 'must']);
  return {
    missing: [...want].filter((code) => !got.has(code)).sort(),
    extra: [...got].filter((code) => !want.has(code)).sort(),
  };
}

/**
 * Technology recall and precision on required (main + must) and on nice, by
 * code; kind on the technologies both list; domain and years only once a
 * human has labeled them (`drafted.requirements` reviewed and the value set).
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
    // A null domain or years in a reviewed label means "not labeled", not "none".
    if (want.domain !== null) {
      counts.domainTotal++;
      if (match.some((r) => r.domain === want.domain)) counts.domainRight++;
    }
    if (want.years !== null) {
      counts.yearsTotal++;
      if (match.some((r) => sameRange(r.years, want.years)))
        counts.yearsRight++;
    }
  }
  return counts;
}

function scoreRequiredLanguages(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.requiredLanguages) return;
  const want = c.expected.requiredLanguages.map((language) => language.lang);
  const got = (doc.requiredLanguages.value ?? []).map(
    (language) => language.lang,
  );
  put(
    facts,
    'requiredLanguages',
    sameSet(want, got),
    doc.requiredLanguages,
    want,
    got,
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
    c.expected.sponsorship,
    doc.workAuthorization.value?.sponsorship ?? null,
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
    c.expected.salary,
    doc.salary.value,
  );
}

function scoreJunkFlags(
  doc: ExtractionDocument,
  c: GoldenCase,
  facts: FactScores['facts'],
): void {
  if (!c.expected.junkFlags) return;
  const got = (doc.junkFlags.value ?? []).map((flag) => flag.code);
  put(
    facts,
    'junkFlags',
    sameSet(c.expected.junkFlags, got),
    doc.junkFlags,
    c.expected.junkFlags,
    got,
  );
}

export interface FactReport {
  /** Cases with a golden value for this fact. */
  scored: number;
  /** Null when no case is scored. */
  accuracy: number | null;
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

export interface EvalReport {
  cases: number;
  facts: Record<FactName, FactReport>;
  requirements: RequirementReport;
  /** Share of `sure` facts (mainStack aside) the golden value contradicts. */
  sureContradicted: number;
  sureFacts: number;
  casesWithSureContradiction: number;
  generatorCallsPerJob: number;
  costPerJob: number;
  bars: Record<keyof typeof BARS, boolean>;
  pass: boolean;
}

const ratio = (num: number, den: number): number | null =>
  den === 0 ? null : num / den;

export function summarize(scores: FactScores[]): EvalReport {
  const summary = summarizeFacts(scores);
  const { facts, sure, sureWrong, wrongCases } = summary;

  const sureContradicted = sure === 0 ? 0 : sureWrong / sure;
  const bars = {
    openingPlaces: (facts.openingPlaces.accuracy ?? 0) >= BARS.openingPlaces,
    arrangement: (facts.arrangement.accuracy ?? 0) >= BARS.arrangement,
    mainStack: (facts.mainStack.accuracy ?? 0) >= BARS.mainStack,
    sureContradicted: sureContradicted <= BARS.sureContradicted,
  };
  const perJob = (pick: (s: FactScores) => number): number =>
    scores.length === 0
      ? 0
      : scores.reduce((n, s) => n + pick(s), 0) / scores.length;
  return {
    cases: scores.length,
    facts,
    requirements: summarizeRequirements(scores),
    sureContradicted,
    sureFacts: sure,
    casesWithSureContradiction: wrongCases.size,
    generatorCallsPerJob: perJob((s) => s.generatorCalls),
    costPerJob: perJob((s) => s.costUsd),
    bars,
    pass: Object.values(bars).every(Boolean),
  };
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

/** Where `processor:eval` writes the report of a run with `generator`, next to `cases/`. */
export function reportFileName(generator: string): string {
  const slug = generator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `last-report.${slug}.json`;
}
