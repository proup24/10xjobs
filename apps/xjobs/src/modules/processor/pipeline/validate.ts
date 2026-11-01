import { Position } from '../../../common/enums/position.enum';
import type { PostingInput } from '../models/types';
import type { ExtractionDocument } from '../schema';

const ENGINEERING_CODES = new Set<string>(Object.values(Position));

/** NFKC, straight quotes and dashes, single spaces, lower case. */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type AnyFact = { quote: string; confidence: 'sure' | 'unsure' };

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
    techStack: out.techStack,
    requiredLanguages: out.requiredLanguages,
    workAuthorization: out.workAuthorization,
    junkFlags: out.junkFlags,
  };
  for (const fact of Object.values(facts)) {
    if (bad(fact.quote)) {
      fact.quote = '';
      fact.confidence = 'unsure';
      quoteFailures++;
    }
  }
  for (const opening of out.openings) {
    if (bad(opening.quote)) {
      opening.quote = '';
      opening.confidence = 'unsure';
      quoteFailures++;
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
export function checkConsistency(doc: ExtractionDocument): ExtractionDocument {
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
    if (isEngineering !== ENGINEERING_CODES.has(roleKind)) {
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
    doc.techStack.confidence === 'unsure'
  );
}
