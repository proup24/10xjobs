import type { ExtractionDocument, Fact, ModelOutput } from '../schema';

interface ModelFact<T> {
  value: T | null;
  quote: string;
  confidence: 'sure' | 'unsure';
}

/**
 * The generator's output as an extraction document, before verification:
 * every fact is the generator's, unverified. The posting text is the only
 * source, so a fact it leaves unstated stays unstated.
 */
export function resolveFacts(args: {
  output: ModelOutput;
  generatorModel: string;
}): ExtractionDocument {
  const { output, generatorModel } = args;

  const generated = <T>(f: ModelFact<T>): Fact<T> => ({
    value: f.value,
    confidence: f.confidence,
    decidedBy: 'generator',
    score: null,
    quote: f.quote,
    model: generatorModel,
    verification: null,
  });

  return {
    position: generated(output.position),
    isSoftwareEngineeringRole: generated(output.isSoftwareEngineeringRole),
    seniority: generated(output.seniority),
    yearsRequired: generated(output.yearsRequired),
    arrangement: generated(output.arrangement),
    openings: output.openings.map((o) => ({
      ...o,
      places: o.places.map((p) =>
        p.kind === 'city' ? { ...p, cityId: null } : p,
      ),
      decidedBy: 'generator' as const,
    })),
    contractType: generated(output.contractType),
    engagement: generated(output.engagement),
    contractMonths: generated(output.contractMonths),
    salary: generated(output.salary),
    // The stack is quoted per requirement; its envelope quote is unused.
    techStack: { ...generated(output.techStack), quote: '' },
    requiredLanguages: generated(output.requiredLanguages),
    workAuthorization: resolveSponsorship(
      generated(output.workAuthorization),
      null,
    ),
    junkFlags: resolveJunk(output, generatorModel),
    unmatched: [],
    // The posting's truncation is the caller's to record: it knows the input.
    truncated: false,
    verification: {
      rounds: 1,
      regenerationInvalid: false,
      dropped: [],
      missedJunkFlags: [],
    },
    models: { verifier: null, generator: generatorModel },
  };
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
