import { Injectable } from '@nestjs/common';
import { ExtractionInvalidError } from '../models/errors';
import type { ModelCallMeta, PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { resolveFacts } from '../rules/resolve-facts';
import { stackIssues } from '../rules/stack';
import { checkConsistency, checkQuotes } from '../rules/validate';
import {
  type ExtractionDocument,
  extractionDocumentSchema,
  type ModelOutput,
} from '../schema';
import { resolveTerms, type TermResolution } from '../vocab/resolve';
import { zodErrors } from '../schema/errors';

/** A validated document, plus the vocabulary it would add; nothing is written yet. */
export interface AssembledDocument {
  doc: ExtractionDocument;
  quoteFailures: number;
  /** Unmatched terms to propose, written only when the extraction is saved. */
  proposals: TermResolution['proposals'];
  /** Cities to create or find, written only when the extraction is saved. */
  cities: TermResolution['cities'];
}

/**
 * Turns the generator's output into one extraction document, then runs every
 * check on it: quotes, consistency, list codes, final shape.
 * Pure: it reads the vocabulary snapshot and writes nothing, so a preview can
 * run it, and a rejected document leaves no proposals behind.
 */
@Injectable()
export class FactAssembler {
  /** Throws ExtractionInvalidError for anything a better output could fix. */
  assemble(
    output: ModelOutput,
    meta: ModelCallMeta,
    input: PostingInput,
    vocabulary: Vocabulary,
  ): AssembledDocument {
    // The model the provider reports, so each fact names the exact model ID.
    const resolved = {
      ...resolveFacts({ output, generatorModel: meta.model }),
      truncated: input.truncated,
    };
    const quoted = checkQuotes(resolved, input);
    const consistent = checkConsistency(
      quoted.doc,
      vocabulary.engineeringRoleKinds,
    );
    const terms = resolveTerms(consistent, vocabulary.vocab);
    checkStack(terms.doc);
    return {
      doc: validDocument(terms.doc),
      quoteFailures: quoted.quoteFailures,
      proposals: terms.proposals,
      cities: terms.cities,
    };
  }
}

/** The tech stack rules (spec §5a), after term codes are resolved; a failure goes to the schema retry. */
function checkStack(doc: ExtractionDocument): void {
  const stack = doc.techStack.value;
  if (!stack) return;
  const errors = stackIssues(stack).map((i) => ({
    path: `techStack.value.${i.path.join('.')}`,
    message: i.message,
  }));
  if (errors.length === 0) return;
  throw new ExtractionInvalidError(
    errors[0].path,
    errors.map((e) => `${e.path}: ${e.message}`).join('; '),
  );
}

/** The final shape check; a failure is reported with its path. */
function validDocument(doc: ExtractionDocument): ExtractionDocument {
  const parsed = extractionDocumentSchema.safeParse(doc);
  if (parsed.success) return parsed.data;
  throw new ExtractionInvalidError(
    parsed.error.issues[0]?.path.join('.') ?? '',
    zodErrors(parsed.error).join('; '),
  );
}

/** `path: message`; the final shape check already puts paths in its message. */
export function invalidMessage(error: ExtractionInvalidError): string {
  return error.message.startsWith(`${error.path}:`)
    ? error.message
    : `${error.path}: ${error.message}`;
}
