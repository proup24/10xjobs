import type { PostingInput } from '../models/types';
import type { ExtractionDocument } from '../schema';

// Soft hyphen, zero-width space/non-joiner/joiner, word joiner, BOM.
const INVISIBLES = new RegExp('[\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]', 'g');

/** NFKC, straight quotes and dashes, single spaces, lower case. */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(INVISIBLES, '')
    .replace(/′′|″/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whether a value says something about the posting (null, unstated and empty do not). */
function isEstablished(name: string, value: unknown): boolean {
  if (value === null || value === undefined || value === 'unstated')
    return false;
  if (Array.isArray(value)) return value.length > 0;
  if (name === 'workAuthorization') {
    const w = value as { requirements: unknown[]; sponsorship: string };
    return w.requirements.length > 0 || w.sponsorship !== 'unstated';
  }
  return true;
}

type AnyFact = {
  quote: string;
  confidence: 'sure' | 'unsure';
  decidedBy: string;
  value: unknown;
};

function invalidateQuote(holder: { quote: string; confidence: 'sure' | 'unsure' }): void {
  holder.quote = '';
  holder.confidence = 'unsure';
}

function checkFactQuotes(
  facts: Record<string, AnyFact>,
  isBad: (quote: string) => boolean,
): number {
  let failures = 0;
  for (const [name, fact] of Object.entries(facts)) {
    if (isBad(fact.quote)) {
      invalidateQuote(fact);
      failures++;
    } else if (
      fact.quote === '' &&
      fact.confidence === 'sure' &&
      fact.decidedBy === 'generator' &&
      isEstablished(name, fact.value)
    ) {
      // The generator established a value without quoting the posting: not supported.
      fact.confidence = 'unsure';
    }
  }
  return failures;
}

function checkOpeningQuotes(
  openings: ExtractionDocument['openings'],
  isBad: (quote: string) => boolean,
): number {
  let failures = 0;
  for (const opening of openings) {
    if (isBad(opening.quote)) {
      invalidateQuote(opening);
      failures++;
    } else if (
      opening.quote === '' &&
      opening.confidence === 'sure' &&
      opening.decidedBy === 'generator' &&
      opening.places.length > 0
    ) {
      opening.confidence = 'unsure';
    }
  }
  return failures;
}

function checkTechStackQuotes(
  techStack: ExtractionDocument['techStack'],
  isBad: (quote: string) => boolean,
): number {
  let failures = 0;
  for (const req of techStack.value?.requirements ?? []) {
    if (isBad(req.quote)) {
      invalidateQuote(req);
      failures++;
    } else if (
      req.quote === '' &&
      req.confidence === 'sure' &&
      techStack.decidedBy === 'generator'
    ) {
      // A requirement with no quote from the posting is not supported.
      req.confidence = 'unsure';
    }
  }
  return failures;
}

function checkEnvelopeListQuotes(
  envelope: { confidence: 'sure' | 'unsure'; value: Array<{ quote: string }> | null },
  isBad: (quote: string) => boolean,
): number {
  let failures = 0;
  for (const item of envelope.value ?? []) {
    if (isBad(item.quote)) {
      item.quote = '';
      envelope.confidence = 'unsure';
      failures++;
    }
  }
  return failures;
}

/** Clear every quote that is not in the input and downgrade the fact that carried it. */
export function checkQuotes(
  doc: ExtractionDocument,
  input: PostingInput,
): { doc: ExtractionDocument; quoteFailures: number } {
  const out = structuredClone(doc);
  const haystack = normalizeForQuote(
    [input.title, input.description].filter((s): s is string => !!s).join('\n'),
  );
  const bad = (quote: string): boolean =>
    quote !== '' && !haystack.includes(normalizeForQuote(quote));

  const facts: Record<string, AnyFact> = {
    position: out.position,
    isSoftwareEngineeringRole: out.isSoftwareEngineeringRole,
    seniority: out.seniority,
    yearsRequired: out.yearsRequired,
    arrangement: out.arrangement,
    contractType: out.contractType,
    engagement: out.engagement,
    contractMonths: out.contractMonths,
    salary: out.salary,
    // techStack is checked per requirement: its envelope quote is unused.
    requiredLanguages: out.requiredLanguages,
    workAuthorization: out.workAuthorization,
    junkFlags: out.junkFlags,
  };

  let quoteFailures = 0;
  quoteFailures += checkFactQuotes(facts, bad);
  quoteFailures += checkOpeningQuotes(out.openings, bad);
  quoteFailures += checkTechStackQuotes(out.techStack, bad);
  quoteFailures += checkEnvelopeListQuotes(out.requiredLanguages, bad);
  quoteFailures += checkEnvelopeListQuotes(out.junkFlags, bad);

  return { doc: out, quoteFailures };
}

/** Cross-fact rules; a disagreement downgrades both sides to unsure. */
export function checkConsistency(
  doc: ExtractionDocument,
  engineeringRoleKinds: Set<string>,
): ExtractionDocument {
  const out = structuredClone(doc);

  const arrangement = out.arrangement.value;
  if (
    arrangement !== null &&
    arrangement !== 'unstated' &&
    !out.openings.some((o) => o.arrangements.includes(arrangement))
  ) {
    out.arrangement.confidence = 'unsure';
    for (const o of out.openings) o.confidence = 'unsure';
  }

  const isEngineering = out.isSoftwareEngineeringRole.value;
  const roleKind = out.position.value?.roleKind;
  if (
    isEngineering !== null &&
    roleKind !== undefined &&
    roleKind !== 'unstated'
  ) {
    if (isEngineering !== engineeringRoleKinds.has(roleKind)) {
      out.isSoftwareEngineeringRole.confidence = 'unsure';
      out.position.confidence = 'unsure';
    }
  }
  return out;
}

/** True when a fact qualify reads is unsure, or the verification dropped or missed something. */
export function needsReview(doc: ExtractionDocument): boolean {
  return (
    doc.arrangement.confidence === 'unsure' ||
    doc.openings.some((o) => o.confidence === 'unsure') ||
    doc.seniority.confidence === 'unsure' ||
    doc.position.confidence === 'unsure' ||
    doc.contractType.confidence === 'unsure' ||
    doc.engagement.confidence === 'unsure' ||
    doc.isSoftwareEngineeringRole.confidence === 'unsure' ||
    doc.verification.dropped.length > 0 ||
    doc.verification.missedJunkFlags.length > 0 ||
    (doc.techStack.value?.requirements ?? []).some(
      (r) => r.kind === 'main' && r.confidence === 'unsure',
    )
  );
}
