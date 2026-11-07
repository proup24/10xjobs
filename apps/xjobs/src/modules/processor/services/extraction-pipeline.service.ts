import { Injectable } from '@nestjs/common';
import { ExtractionInvalidError } from '../models/errors';
import type { PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import type { AttemptLog } from './attempt-log';
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
 *   1. ExtractionService   the generator extracts every fact
 *   2. FactAssembler       resolve with the ingest evidence, check, map terms to the lists
 *
 * Interim, generator only: Jev's verification arrives with the
 * generate-then-verify pipeline.
 *
 * Anything a better generator output could fix (bad JSON, schema errors, an
 * unapproved code, an invalid document) gets one retry with its errors.
 * Writes nothing: the caller decides whether to save.
 */
@Injectable()
export class ExtractionPipeline {
  constructor(
    private readonly extraction: ExtractionService,
    private readonly assembler: FactAssembler,
  ) {}

  async run(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<AssembledDocument> {
    let retryErrors: string[] | undefined;
    for (const step of ['extraction', 'extraction_retry'] as const) {
      const call = await this.extraction.call(
        step,
        input,
        vocabulary,
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
          call.meta,
          input,
          vocabulary,
        );
        log.setLastQuoteFailures(assembled.quoteFailures);
        log.debug(
          `document assembled: ${assembled.doc.openings.length} openings, ${assembled.quoteFailures} unsupported quotes cleared, ${assembled.doc.conflicts.length} evidence conflicts, ${assembled.proposals.length} new terms, ${assembled.cities.length} cities`,
        );
        return assembled;
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const message = invalidMessage(error);
        log.markLastInvalid(message);
        retryErrors = [message];
      }
    }
    log.warn('the extraction was invalid twice; giving up');
    throw new ExtractionFailed(retryErrors ?? []);
  }
}
