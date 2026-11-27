import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
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
import { type ModelOutput, modelOutputSchema } from '../schema';
import { zodErrors } from '../schema/errors';
import type { AttemptLog } from './attempt-log';
import {
  type AssembledDocument,
  FactAssembler,
  invalidMessage,
} from './fact-assembler.service';

/** One generation: a valid assembled document, or the last try's errors. */
export type GenerationResult<T = AssembledDocument> =
  | { ok: true; assembled: T }
  | { ok: false; errors: string[] };

/**
 * What one document type brings to the generation loop: its prompt, its
 * model output schema and its assembler. `assemble` throws
 * ExtractionInvalidError for output to send back; its `quoteFailures` are
 * recorded on the call's attempt, and `describe` gives the debug lines logged
 * after a valid assembly.
 */
export interface GenerationSpec<T extends { quoteFailures: number }> {
  systemPrompt(): string;
  schema(v: Vocabulary): z.ZodType;
  assemble(
    parsed: unknown,
    meta: ModelCallMeta,
    input: PostingInput,
    v: Vocabulary,
  ): T;
  describe?(assembled: T): string[];
}

/**
 * One generation (spec §2): the generator writes the whole document, and the
 * assembler checks it. Up to `config.generationTries` model calls: output
 * that fails the schema or the assembler goes back with its errors.
 * Provider and request failures are thrown.
 */
@Injectable()
export class GenerationService {
  private readonly listing: GenerationSpec<AssembledDocument>;

  constructor(
    private readonly model: ExtractionModel,
    assembler: FactAssembler,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {
    this.listing = {
      systemPrompt,
      schema: (v) => modelOutputSchema(v.options),
      assemble: (parsed, meta, input, v) =>
        assembler.assemble(parsed as ModelOutput, meta, input, v),
      describe: (assembled) => {
        const { mergedDuplicates } = assembled;
        return [
          `document assembled: ${assembled.doc.openings.length} openings, ${assembled.quoteFailures} unsupported quotes cleared, ${assembled.proposals.length} new terms, ${assembled.cities.length} cities`,
          ...(mergedDuplicates.length > 0
            ? [
                `merged ${mergedDuplicates.length} duplicate requirements (${mergedDuplicates.join(', ')})`,
              ]
            : []),
        ];
      },
    };
  }

  /** A listing's generation. */
  generate(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<GenerationResult> {
    return this.generateWith(this.listing, input, vocabulary, log);
  }

  /** The first call is logged as `generation`, every later try as `generation_retry`. */
  async generateWith<T extends { quoteFailures: number }>(
    spec: GenerationSpec<T>,
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<GenerationResult<T>> {
    const model = this.config.extractionModel;
    const schema = spec.schema(vocabulary);
    let errors: string[] = [];
    // What the next try sends back: the errors, unless the call said otherwise.
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= this.config.generationTries; attempt++) {
      const current = attempt === 1 ? 'generation' : 'generation_retry';
      const retryErrors =
        attempt === 1 || feedback.length === 0 ? undefined : feedback;
      log.calling(
        current,
        model,
        [
          `${kb(input.description)} posting${input.truncated ? ' (truncated)' : ''}`,
          attempt > 1 &&
            (retryErrors
              ? `retrying ${retryErrors.length} errors`
              : 'retrying without feedback'),
          `try ${attempt} of ${this.config.generationTries}`,
        ]
          .filter(Boolean)
          .join(', '),
      );
      let result: { output: unknown; meta: ModelCallMeta };
      try {
        result = await this.model.generate(input, {
          systemPrompt: spec.systemPrompt(),
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
        feedback = error.retryErrors ?? errors;
        continue;
      }
      // The model already checked the schema; parsed again for the types.
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        errors = feedback = zodErrors(parsed.error);
        log.invalid(current, model, result.meta, errors.join('; '));
        continue;
      }
      log.ok(current, model, result.meta);
      try {
        const assembled = spec.assemble(
          parsed.data,
          result.meta,
          input,
          vocabulary,
        );
        log.setLastQuoteFailures(assembled.quoteFailures);
        for (const line of spec.describe?.(assembled) ?? []) log.debug(line);
        return { ok: true, assembled };
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const message = invalidMessage(error);
        log.markLastInvalid(message);
        errors = feedback = [message];
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
