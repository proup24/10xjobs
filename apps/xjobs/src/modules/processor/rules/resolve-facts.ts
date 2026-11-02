import { thresholdFor } from '../config/thresholds';
import type {
  DecisionAnswer,
  DecisionQuestion,
  Evidence,
  PostingInput,
} from '../models/types';
import type { ExtractionDocument, Fact, ModelOutput } from '../schema';
import { allowedCodes, contradictsEvidence } from './evidence';

type Conflict = ExtractionDocument['conflicts'][number];
type Answer = string | boolean | null;

const INGEST_FIELD = {
  seniority: (e: Evidence) => e.experienceLevel,
  contractType: (e: Evidence) => e.contractType,
} as const;

function jevStands(
  answer: DecisionAnswer | undefined,
  decisionModel: string,
  evidence: Evidence,
): boolean {
  if (!answer || answer.value === null) return false;
  const threshold = thresholdFor(decisionModel, answer.key);
  if (threshold === null || answer.score < threshold) return false;
  return !contradictsEvidence(answer.key, answer.value, evidence);
}

/** Closed questions Opus must answer: low Jev confidence, no answer, or a contradiction. */
export function selectFallback(
  answers: DecisionAnswer[],
  questions: DecisionQuestion[],
  evidence: Evidence,
  decisionModel: string,
): DecisionQuestion[] {
  const byKey = new Map(answers.map((a) => [a.key, a]));
  return questions.filter(
    (q) => !jevStands(byKey.get(q.key), decisionModel, evidence),
  );
}

interface ModelFact<T> {
  value: T | null;
  quote: string;
  confidence: 'sure' | 'unsure';
}

export function resolveFacts(args: {
  output: ModelOutput;
  answers: DecisionAnswer[];
  fallback: DecisionQuestion[];
  input: PostingInput;
  models: { decision: string; extraction: string };
}): ExtractionDocument {
  const { output, answers, input, models } = args;
  const evidence = input.evidence;
  const answerByKey = new Map(answers.map((a) => [a.key, a]));
  const fallbackKeys = new Set(args.fallback.map((q) => q.key));
  const conflicts: Conflict[] = [];
  const opusFallback = output.fallback as Record<
    string,
    ModelFact<string | boolean> | undefined
  >;

  const openFact = <T>(f: ModelFact<T>): Fact<T> => ({
    value: f.value,
    confidence: f.confidence,
    decidedBy: 'opus',
    score: null,
    quote: f.quote,
    model: models.extraction,
  });

  /** One closed fact: Jev if he stands, else Opus, else the ingest evidence. */
  const closed = <T extends Answer>(
    key: DecisionQuestion['key'],
    field: string,
    topLevel: ModelFact<T>,
  ): Fact<T> => {
    const answer = answerByKey.get(key);
    const threshold = thresholdFor(models.decision, key);
    const confidentJev =
      !!answer &&
      answer.value !== null &&
      threshold !== null &&
      answer.score >= threshold;
    const jevContradicts =
      !!answer && contradictsEvidence(key, answer.value, evidence);

    const jevStands = !fallbackKeys.has(key) && confidentJev && !jevContradicts;
    const opus = (opusFallback[key] as ModelFact<T> | undefined) ?? topLevel;
    const score = answer?.score ?? null;
    const standing: Fact<T> = jevStands
      ? {
          value: answer.value as T,
          confidence: 'sure',
          decidedBy: 'jev',
          score: answer.score,
          quote: '',
          model: models.decision,
        }
      : {
          value: opus.value,
          confidence: opus.confidence,
          decidedBy: 'opus',
          score,
          quote: opus.quote,
          model: models.extraction,
        };

    // Evidence only: the posting says nothing, whoever decided that, and
    // LinkedIn states a value.
    if (standing.value === null || standing.value === 'unstated') {
      const ingestValue = ingestFallback(key, evidence);
      if (ingestValue !== null) {
        recordConflict(field, key, answer, confidentJev, ingestValue);
        return {
          value: ingestValue as T,
          confidence: 'unsure',
          decidedBy: 'ingest',
          score: null,
          quote: '',
          model: null,
        };
      }
    }
    if (!jevStands)
      recordConflict(field, key, answer, confidentJev, standing.value);
    return standing;
  };

  // Rule: an unconfident Jev answer that Opus overrode is not a conflict;
  // the standing answer (Opus's, or the ingest fallback) is what gets compared.
  const recordConflict = (
    field: string,
    key: DecisionQuestion['key'],
    answer: DecisionAnswer | undefined,
    confidentJev: boolean,
    finalValue: unknown,
  ): void => {
    const ingest =
      key === 'seniority' || key === 'contractType'
        ? INGEST_FIELD[key](evidence)
        : null;
    if (ingest === null) return;
    if (
      answer &&
      confidentJev &&
      contradictsEvidence(key, answer.value, evidence)
    ) {
      conflicts.push({
        field,
        ingestValue: ingest,
        extractedValue: answer.value,
      });
    } else if (contradictsEvidence(key, finalValue, evidence)) {
      conflicts.push({
        field,
        ingestValue: ingest,
        extractedValue: finalValue,
      });
    }
  };

  const roleKind = closed<string | null>('roleKind', 'roleKind', {
    ...output.position,
    value: output.position.value?.roleKind ?? null,
  } as ModelFact<string | null>);
  const position: Fact<{ roleKind: string; title: string }> = {
    ...roleKind,
    value:
      roleKind.value === null
        ? output.position.value
        : {
            roleKind: roleKind.value,
            title: output.position.value?.title ?? '',
          },
    confidence:
      roleKind.confidence === 'unsure' ||
      output.position.confidence === 'unsure'
        ? 'unsure'
        : 'sure',
    quote: roleKind.quote || output.position.quote,
  };

  const junkFlags = resolveJunk(
    output,
    answerByKey,
    fallbackKeys,
    opusFallback,
    models,
  );
  const workAuthorization = resolveSponsorship(
    openFact(output.workAuthorization),
    closed<string | null>('sponsorshipOffered', 'sponsorshipOffered', {
      value: null,
      quote: '',
      confidence: 'sure',
    }),
    answerByKey.has('sponsorshipOffered') ||
      fallbackKeys.has('sponsorshipOffered'),
  );

  return {
    position,
    isSoftwareEngineeringRole: closed<boolean | null>(
      'isSoftwareEngineeringRole',
      'isSoftwareEngineeringRole',
      output.isSoftwareEngineeringRole,
    ),
    seniority: closed('seniority', 'seniority', output.seniority),
    yearsRequired: openFact(output.yearsRequired),
    arrangement: closed('arrangement', 'arrangement', output.arrangement),
    openings: output.openings.map(({ fromListing, ...o }) => ({
      ...o,
      places: o.places.map((p) =>
        p.kind === 'city' ? { ...p, cityId: null } : p,
      ),
      confidence: fromListing ? ('unsure' as const) : o.confidence,
      decidedBy: fromListing ? ('ingest' as const) : ('opus' as const),
    })),
    contractType: closed('contractType', 'contractType', output.contractType),
    engagement: closed('engagement', 'engagement', output.engagement),
    contractMonths: openFact(output.contractMonths),
    salary: resolveSalary(openFact(output.salary), evidence, conflicts),
    techStack: openFact(output.techStack),
    requiredLanguages: openFact(output.requiredLanguages),
    workAuthorization,
    junkFlags,
    conflicts,
    unmatched: [],
    truncated: input.truncated,
    models: { decision: models.decision, extraction: models.extraction },
  } as ExtractionDocument;
}

/** The evidence value when it maps to exactly one code (contractType: its first code). */
function ingestFallback(
  key: DecisionQuestion['key'],
  evidence: Evidence,
): string | null {
  if (key !== 'seniority' && key !== 'contractType') return null;
  const allowed = allowedCodes(key, evidence);
  if (!allowed || allowed.length === 0) return null;
  if (key === 'seniority' && allowed.length !== 1) return null;
  return allowed[0];
}

function resolveSponsorship(
  open: Fact<ExtractionDocument['workAuthorization']['value'] & object>,
  sponsorship: Fact<string | null>,
  asked: boolean,
): ExtractionDocument['workAuthorization'] {
  const wanted = sponsorship.value;
  if (!asked || (wanted !== 'yes' && wanted !== 'no' && wanted !== 'unstated'))
    return open;
  return {
    ...open,
    value: {
      requirements: open.value?.requirements ?? [],
      sponsorship: wanted,
    },
    confidence:
      open.confidence === 'unsure' || sponsorship.confidence === 'unsure'
        ? 'unsure'
        : 'sure',
    decidedBy: sponsorship.decidedBy,
    score: sponsorship.score,
    model: sponsorship.model,
  };
}

function resolveJunk(
  output: ModelOutput,
  answerByKey: Map<DecisionAnswer['key'], DecisionAnswer>,
  fallbackKeys: Set<DecisionQuestion['key']>,
  opusFallback: Record<string, ModelFact<string | boolean> | undefined>,
  models: { decision: string; extraction: string },
): ExtractionDocument['junkFlags'] {
  const flags = new Map(
    (output.junkFlags.value ?? []).map((f) => [f.code, f] as const),
  );
  const keys = new Set<string>([
    ...[...answerByKey.keys()].filter((k) => k.startsWith('junk:')),
    ...[...fallbackKeys].filter((k) => k.startsWith('junk:')),
  ]);
  let downgraded = false;
  for (const key of keys) {
    const code = key.slice('junk:'.length);
    const answer = answerByKey.get(key as DecisionAnswer['key']);
    const threshold = thresholdFor(
      models.decision,
      key as DecisionAnswer['key'],
    );
    const jevStands =
      !fallbackKeys.has(key as DecisionQuestion['key']) &&
      !!answer &&
      typeof answer.value === 'boolean' &&
      threshold !== null &&
      answer.score >= threshold;
    const value = jevStands
      ? (answer.value as boolean)
      : (opusFallback[key]?.value ?? flags.has(code));
    const unsureOpus = !jevStands && opusFallback[key]?.confidence === 'unsure';
    if (value === true && !flags.has(code)) {
      downgraded ||= unsureOpus;
      flags.set(code, {
        code,
        quote: jevStands ? '' : (opusFallback[key]?.quote ?? ''),
      });
    } else if (value === false) {
      downgraded ||= unsureOpus && flags.has(code);
      flags.delete(code);
    }
  }
  return {
    ...openJunk(output, models.extraction),
    confidence:
      downgraded || output.junkFlags.confidence === 'unsure'
        ? 'unsure'
        : 'sure',
    value: [...flags.values()],
  };
}

function openJunk(
  output: ModelOutput,
  model: string,
): Omit<ExtractionDocument['junkFlags'], 'value'> {
  return {
    confidence: output.junkFlags.confidence,
    decidedBy: 'opus',
    score: null,
    quote: output.junkFlags.quote,
    model,
  };
}

const PERIODS: Record<string, 'hour' | 'day' | 'month' | 'year'> = {
  hour: 'hour',
  hourly: 'hour',
  day: 'day',
  daily: 'day',
  month: 'month',
  monthly: 'month',
  year: 'year',
  yearly: 'year',
  annual: 'year',
  annually: 'year',
};

/** The posting text wins over LinkedIn's salary; a difference is a conflict. */
function resolveSalary(
  fact: ExtractionDocument['salary'],
  evidence: Evidence,
  conflicts: Conflict[],
): ExtractionDocument['salary'] {
  const ev = evidence.salary;
  if (!ev || (ev.min === null && ev.max === null)) return fact;
  if (fact.value !== null) {
    const evPeriod =
      ev.period === null
        ? null
        : (PERIODS[ev.period.toLowerCase()] ?? ev.period);
    const differs =
      (ev.min !== null && ev.min !== fact.value.min) ||
      (ev.max !== null && ev.max !== fact.value.max) ||
      (ev.currency !== null && ev.currency !== fact.value.currency) ||
      (evPeriod !== null && evPeriod !== fact.value.period);
    if (differs) {
      conflicts.push({
        field: 'salary',
        ingestValue: {
          min: ev.min,
          max: ev.max,
          currency: ev.currency,
          period: ev.period,
        },
        extractedValue: fact.value,
      });
    }
    return fact;
  }
  const period =
    ev.period === null ? undefined : PERIODS[ev.period.toLowerCase()];
  if (ev.currency === null || !/^[A-Z]{3}$/.test(ev.currency) || !period) {
    return fact;
  }
  return {
    value: {
      min: ev.min === null ? null : Math.round(ev.min),
      max: ev.max === null ? null : Math.round(ev.max),
      currency: ev.currency,
      period,
    },
    confidence: 'unsure',
    decidedBy: 'ingest',
    score: null,
    quote: '',
    model: null,
  };
}
