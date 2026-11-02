import { Injectable } from '@nestjs/common';
import { ExtractionInvalidError } from '../models/errors';
import type { PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import type { AttemptLog } from './attempt-log';
import { DecisionService } from './decision.service';
import { ExtractionService } from './extraction.service';
import {
  type AssembledDocument,
  FactAssembler,
  invalidMessage,
} from './fact-assembler.service';

/** The extraction failed twice: the job fails with these errors. */
export class ExtractionFailed extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'ExtractionFailed';
  }
}

/**
 * A posting in, a validated document out:
 *
 *   1. DecisionService     Jev answers the closed questions
 *   2. ExtractionService   Opus extracts the rest and the low-confidence answers
 *   3. FactAssembler       merge, check, map terms to the lists
 *
 * Anything a better Opus output could fix (bad JSON, schema errors, an
 * unapproved code, an invalid document) gets one retry with its errors.
 * Writes nothing: the caller decides whether to save.
 */
@Injectable()
export class ExtractionPipeline {
  constructor(
    private readonly decisions: DecisionService,
    private readonly extraction: ExtractionService,
    private readonly assembler: FactAssembler,
  ) {}

  async run(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<AssembledDocument> {
    const decided = await this.decisions.ask(input, vocabulary, log);
    let retryErrors: string[] | undefined;
    for (const step of ['extraction', 'extraction_retry'] as const) {
      const call = await this.extraction.call(
        step,
        input,
        vocabulary,
        decided.fallback,
        retryErrors,
        log,
      );
      if (!call.ok) {
        retryErrors = call.errors;
        continue;
      }
      try {
        const assembled = this.assembler.assemble(
          call.output,
          decided,
          call.meta,
          input,
          vocabulary,
        );
        log.setLastQuoteFailures(assembled.quoteFailures);
        return assembled;
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const message = invalidMessage(error);
        log.markLastInvalid(message);
        retryErrors = [message];
      }
    }
    throw new ExtractionFailed(retryErrors ?? []);
  }
}
