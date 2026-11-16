import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ExtractionInvalidError, ModelOutputError } from '../models/errors';
import {
  ExtractionModel,
  type ModelCallMeta,
  type PostingInput,
} from '../models/types';
import { systemPrompt } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import { modelOutputSchema } from '../schema';
import { zodErrors } from '../schema/errors';
import type { AttemptLog } from './attempt-log';
import {
  type AssembledDocument,
  FactAssembler,
  invalidMessage,
} from './fact-assembler.service';

/** One generation: a valid assembled document, or the last try's errors. */
export type GenerationResult =
  | { ok: true; assembled: AssembledDocument }
  | { ok: false; errors: string[] };

/**
 * One generation (spec §2): the generator writes the whole document, and the
 * assembler checks it. Up to `config.generationTries` model calls: output
 * that fails the schema or the assembler goes back with its errors.
 * Provider and request failures are thrown.
 */
@Injectable()
export class GenerationService {
  constructor(
    private readonly model: ExtractionModel,
    private readonly assembler: FactAssembler,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /** The first call is logged as `generation`, every later try as `generation_retry`. */
  async generate(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<GenerationResult> {
    const model = this.config.extractionModel;
    const schema = modelOutputSchema(vocabulary.options);
    let errors: string[] = [];
    for (let attempt = 1; attempt <= this.config.generationTries; attempt++) {
      const current = attempt === 1 ? 'generation' : 'generation_retry';
      const retryErrors = attempt === 1 ? undefined : errors;
      log.calling(
        current,
        model,
        [
          `${kb(input.description)} posting${input.truncated ? ' (truncated)' : ''}`,
          retryErrors && `retrying ${retryErrors.length} errors`,
          `try ${attempt} of ${this.config.generationTries}`,
        ]
          .filter(Boolean)
          .join(', '),
      );
      let result: { output: unknown; meta: ModelCallMeta };
      try {
        result = await this.model.generate(input, {
          systemPrompt: systemPrompt(),
          schema,
          ...(retryErrors ? { retryErrors } : {}),
        });
      } catch (error) {
        if (!(error instanceof ModelOutputError)) {
          log.failed(current, model, error);
          throw error;
        }
        log.invalid(current, model, error.meta, error.message);
        errors = [error.message];
        continue;
      }
      // The model already checked the schema; parsed again for the types.
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        errors = zodErrors(parsed.error);
        log.invalid(current, model, result.meta, errors.join('; '));
        continue;
      }
      log.ok(current, model, result.meta);
      try {
        const assembled = this.assembler.assemble(
          parsed.data,
          result.meta,
          input,
          vocabulary,
        );
        log.setLastQuoteFailures(assembled.quoteFailures);
        log.debug(
          `document assembled: ${assembled.doc.openings.length} openings, ${assembled.quoteFailures} unsupported quotes cleared, ${assembled.proposals.length} new terms, ${assembled.cities.length} cities`,
        );
        const { mergedDuplicates } = assembled;
        if (mergedDuplicates.length > 0) {
          log.debug(
            `merged ${mergedDuplicates.length} duplicate requirements (${mergedDuplicates.join(', ')})`,
          );
        }
        return { ok: true, assembled };
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const message = invalidMessage(error);
        log.markLastInvalid(message);
        errors = [message];
      }
    }
    log.warn(
      `the generation was invalid after ${this.config.generationTries} tries`,
    );
    return { ok: false, errors };
  }
}

const kb = (text: string): string =>
  `${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} KB`;
