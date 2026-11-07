import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ModelOutputError } from '../models/errors';
import {
  ExtractionModel,
  type ModelCallMeta,
  type PostingInput,
} from '../models/types';
import { systemPrompt } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import {
  type ModelOutput,
  modelOutputJsonSchema,
  modelOutputSchema,
} from '../schema';
import type { AttemptLog, AttemptStep } from './attempt-log';

/** One extraction call: a schema-valid output, or the errors a retry can fix. */
export type ExtractionCall =
  | { ok: true; output: ModelOutput; meta: ModelCallMeta }
  | { ok: false; errors: string[] };

/** Step 2: one structured-output call to the extraction model (Opus). */
@Injectable()
export class ExtractionService {
  constructor(
    private readonly extraction: ExtractionModel,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /**
   * Unparseable, cut-off or schema-invalid output is returned as errors, for
   * the one schema-fix retry. Provider and request failures are thrown.
   */
  async call(
    step: AttemptStep,
    input: PostingInput,
    vocabulary: Vocabulary,
    retryErrors: string[] | undefined,
    log: AttemptLog,
  ): Promise<ExtractionCall> {
    const model = this.config.extractionModel;
    const schema = modelOutputSchema(vocabulary.options);
    const jsonSchema = modelOutputJsonSchema(vocabulary.options);
    log.calling(
      step,
      model,
      `${kb(input.description)} posting${input.truncated ? ' (truncated)' : ''}, ${kb(JSON.stringify(jsonSchema))} schema${retryErrors ? `, retrying ${retryErrors.length} errors` : ''}`,
    );
    let result: { output: unknown; meta: ModelCallMeta };
    try {
      result = await this.extraction.extract(input, {
        systemPrompt: systemPrompt(),
        jsonSchema,
        ...(retryErrors ? { retryErrors } : {}),
      });
    } catch (error) {
      if (!(error instanceof ModelOutputError)) {
        log.failed(step, model, error);
        throw error;
      }
      log.invalid(step, model, error.meta, error.message);
      return { ok: false, errors: [error.message] };
    }
    const parsed = schema.safeParse(result.output);
    if (!parsed.success) {
      const errors = zodErrors(parsed.error);
      log.invalid(step, model, result.meta, errors.join('; '));
      return { ok: false, errors };
    }
    log.ok(step, model, result.meta);
    return { ok: true, output: parsed.data, meta: result.meta };
  }
}

const kb = (text: string): string =>
  `${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} KB`;

export const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
