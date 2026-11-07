import type { Evidence, PostingInput } from '../models/types';
import type { ExtractionDocument, Fact, ModelOutput } from '../schema';
import { allowedCodes, contradictsEvidence } from './evidence';

type Conflict = ExtractionDocument['conflicts'][number];
type IngestKey = 'seniority' | 'contractType';

const INGEST_FIELD: Record<IngestKey, (e: Evidence) => string | null> = {
  seniority: (e) => e.experienceLevel,
  contractType: (e) => e.contractType,
};

interface ModelFact<T> {
  value: T | null;
  quote: string;
  confidence: 'sure' | 'unsure';
}

/**
 * The generator's output as an extraction document, before verification:
 * every fact is the generator's, unverified, except where the LinkedIn
 * evidence fills a gap (`seniority`/`contractType` the posting leaves
 * unstated, a salary the posting omits, an opening from the listing).
 * A generator value the evidence contradicts is kept and recorded as a
 * conflict.
 */
export function resolveFacts(args: {
  output: ModelOutput;
  input: PostingInput;
  generatorModel: string;
}): ExtractionDocument {
  const { output, input, generatorModel } = args;
  const evidence = input.evidence;
  const conflicts: Conflict[] = [];

  const generated = <T>(f: ModelFact<T>): Fact<T> => ({
    value: f.value,
    confidence: f.confidence,
    decidedBy: 'generator',
    score: null,
    quote: f.quote,
    model: generatorModel,
    verification: null,
  });

  /** The generator's value; the evidence when the posting leaves it unstated. */
  const withIngest = (key: IngestKey, f: ModelFact<string>): Fact<string> => {
    if (f.value === null || f.value === 'unstated') {
      const ingestValue = ingestFallback(key, evidence);
      if (ingestValue !== null)
        return {
          value: ingestValue,
          confidence: 'unsure',
          decidedBy: 'ingest',
          score: null,
          quote: '',
          model: null,
          verification: null,
        };
    } else if (contradictsEvidence(key, f.value, evidence)) {
      conflicts.push({
        field: key,
        ingestValue: INGEST_FIELD[key](evidence),
        extractedValue: f.value,
      });
    }
    return generated(f);
  };

  const seniority = withIngest('seniority', output.seniority);
  const contractType = withIngest('contractType', output.contractType);

  return {
    position: generated(output.position),
    isSoftwareEngineeringRole: generated(output.isSoftwareEngineeringRole),
    seniority,
    yearsRequired: generated(output.yearsRequired),
    arrangement: generated(output.arrangement),
    openings: output.openings.map(({ fromListing, ...o }) => ({
      ...o,
      places: o.places.map((p) =>
        p.kind === 'city' ? { ...p, cityId: null } : p,
      ),
      confidence: fromListing ? ('unsure' as const) : o.confidence,
      decidedBy: fromListing ? ('ingest' as const) : ('generator' as const),
    })),
    contractType,
    engagement: generated(output.engagement),
    contractMonths: generated(output.contractMonths),
    salary: resolveSalary(generated(output.salary), evidence, conflicts),
    // The stack is quoted per requirement; its envelope quote is unused.
    techStack: { ...generated(output.techStack), quote: '' },
    requiredLanguages: generated(output.requiredLanguages),
    workAuthorization: resolveSponsorship(
      generated(output.workAuthorization),
      null,
    ),
    junkFlags: resolveJunk(output, generatorModel),
    conflicts,
    unmatched: [],
    truncated: input.truncated,
    verification: {
      rounds: 1,
      regenerationInvalid: false,
      dropped: [],
      missedJunkFlags: [],
    },
    models: { verifier: null, generator: generatorModel },
  };
}

/** The evidence value when it maps to exactly one code (contractType: its first code). */
function ingestFallback(key: IngestKey, evidence: Evidence): string | null {
  const allowed = allowedCodes(key, evidence);
  if (!allowed || allowed.length === 0) return null;
  if (key === 'seniority' && allowed.length !== 1) return null;
  return allowed[0];
}

/**
 * The posting's work authorization, with a separately decided sponsorship
 * answer merged in when there is one. The generator states sponsorship inside
 * `workAuthorization`, so until verification supplies its own answer the
 * generator's stands.
 */
function resolveSponsorship(
  open: Fact<ExtractionDocument['workAuthorization']['value'] & object>,
  sponsorship: Fact<string | null> | null,
): ExtractionDocument['workAuthorization'] {
  const wanted = sponsorship?.value;
  if (
    !sponsorship ||
    (wanted !== 'yes' && wanted !== 'no' && wanted !== 'unstated')
  )
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
    verification: sponsorship.verification,
  };
}

/** The junk flags the generator raised, each with its quote. */
function resolveJunk(
  output: ModelOutput,
  model: string,
): ExtractionDocument['junkFlags'] {
  return {
    value: output.junkFlags.value,
    confidence: output.junkFlags.confidence,
    decidedBy: 'generator',
    score: null,
    quote: output.junkFlags.quote,
    model,
    verification: null,
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
    verification: null,
  };
}
