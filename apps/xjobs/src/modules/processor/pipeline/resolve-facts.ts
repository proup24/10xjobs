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

    if (!fallbackKeys.has(key) && confidentJev && !jevContradicts) {
      return {
        value: answer.value as T,
        confidence: 'sure',
        decidedBy: 'jev',
        score: answer.score,
        quote: '',
        model: models.decision,
      };
    }

    const opus = (opusFallback[key] as ModelFact<T> | undefined) ?? topLevel;
    const score = answer?.score ?? null;

    if (opus.value === null || opus.value === 'unstated') {
      const ingestValue = ingestFallback(key, evidence);
      if (ingestValue !== null) {
        recordConflict(field, key, answer, confidentJev, ingestValue);
        return {
          value: ingestValue as T,
          confidence: 'unsure',
          decidedBy: 'ingest',
          score,
          quote: '',
          model: null,
        };
      }
    }
    recordConflict(field, key, answer, confidentJev, opus.value);
    return {
      value: opus.value,
      confidence: opus.confidence,
      decidedBy: 'opus',
      score,
      quote: opus.quote,
      model: models.extraction,
    };
  };

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
    openings: output.openings.map((o) => ({
      ...o,
      places: o.places.map((p) =>
        p.kind === 'city' ? { ...p, cityId: null } : p,
      ),
      decidedBy: 'opus' as const,
    })),
    contractType: closed('contractType', 'contractType', output.contractType),
    engagement: closed('engagement', 'engagement', output.engagement),
    contractMonths: openFact(output.contractMonths),
    salary: openFact(output.salary),
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
    confidence: sponsorship.confidence,
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
    if (value === true && !flags.has(code)) {
      flags.set(code, {
        code,
        quote: jevStands ? '' : (opusFallback[key]?.quote ?? ''),
      });
    } else if (value === false) {
      flags.delete(code);
    }
  }
  return {
    ...openJunk(output, models.extraction),
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
