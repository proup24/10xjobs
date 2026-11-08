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

/** Clear every quote that is not in the input and downgrade the fact that carried it. */
export function checkQuotes(
  doc: ExtractionDocument,
  input: PostingInput,
): { doc: ExtractionDocument; quoteFailures: number } {
  const out = structuredClone(doc);
  const haystack = normalizeForQuote(
    [input.title, input.companyName, input.description]
      .filter((s): s is string => !!s)
      .join('\n'),
  );
  let quoteFailures = 0;
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
    // techStack is checked per requirement below: its envelope quote is unused.
    requiredLanguages: out.requiredLanguages,
    workAuthorization: out.workAuthorization,
    junkFlags: out.junkFlags,
  };
  for (const [name, fact] of Object.entries(facts)) {
    if (bad(fact.quote)) {
      fact.quote = '';
      fact.confidence = 'unsure';
      quoteFailures++;
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
  for (const opening of out.openings) {
    if (bad(opening.quote)) {
      opening.quote = '';
      opening.confidence = 'unsure';
      quoteFailures++;
    } else if (
      opening.quote === '' &&
      opening.confidence === 'sure' &&
      opening.decidedBy === 'generator' &&
      opening.places.length > 0
    ) {
      opening.confidence = 'unsure';
    }
  }
  for (const req of out.techStack.value?.requirements ?? []) {
    if (bad(req.quote)) {
      req.quote = '';
      req.confidence = 'unsure';
      quoteFailures++;
    } else if (
      req.quote === '' &&
      req.confidence === 'sure' &&
      out.techStack.decidedBy === 'generator'
    ) {
      // A requirement with no quote from the posting is not supported.
      req.confidence = 'unsure';
    }
  }
  for (const lang of out.requiredLanguages.value ?? []) {
    if (bad(lang.quote)) {
      lang.quote = '';
      out.requiredLanguages.confidence = 'unsure';
      quoteFailures++;
    }
  }
  for (const flag of out.junkFlags.value ?? []) {
    if (bad(flag.quote)) {
      flag.quote = '';
      out.junkFlags.confidence = 'unsure';
      quoteFailures++;
    }
  }
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

/** True when a fact qualify reads is unsure, or the evidence conflicts with the extraction. */
export function needsReview(doc: ExtractionDocument): boolean {
  return (
    doc.conflicts.length > 0 ||
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
