import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import type { PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { applyVerdicts, carryVerdicts } from '../rules/finalize';
import { type FieldVerdict, generatorAnswers } from '../rules/verify';
import type { AttemptLog } from './attempt-log';
import type { AssembledDocument } from './fact-assembler.service';
import { GenerationService } from './generation.service';
import { VerificationService } from './verification.service';

/** The first generation never produced a valid document: the job fails with these errors. */
export class ExtractionFailed extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'ExtractionFailed';
  }
}

/**
 * A posting in, a verified document out (spec §1):
 *
 *   1. GenerationService     the generator writes the whole document; the assembler checks it
 *   2. VerificationService   Jev verifies the closed fields
 *   3. a field Jev rejects   regenerate with feedback, verify again
 *                            (at most `maxRegenerations` times)
 *   4. applyVerdicts         confirmed sure, unconfirmed unsure, rejected after the last round dropped
 *
 * Writes nothing: the caller decides whether to save.
 */
@Injectable()
export class ExtractionPipeline {
  constructor(
    private readonly generation: GenerationService,
    private readonly verification: VerificationService,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  async run(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<AssembledDocument> {
    const options = vocabulary.options;
    const first = await this.generation.generate(
      input,
      vocabulary,
      undefined,
      'generation',
      log,
    );
    if (!first.ok) {
      log.warn('the first generation never produced a valid document');
      throw new ExtractionFailed(first.errors);
    }
    let current = first.assembled;
    let answers = generatorAnswers(current.doc, options);
    let verdicts = await this.verification.verify(
      current.doc,
      input,
      vocabulary,
      undefined,
      log,
    );

    for (let round = 1; ; round++) {
      const rejected = verdicts.filter((v) => v.verdict === 'rejected');
      if (rejected.length === 0)
        return this.finalize(current, verdicts, round, false, log);
      if (round > this.config.maxRegenerations) {
        log.info(
          `Jev still rejects ${keys(rejected)} after ${round} rounds; dropped`,
        );
        return this.finalize(current, verdicts, round, false, log);
      }
      log.info(`Jev rejects ${keys(rejected)}; regenerating`);
      const next = await this.generation.generate(
        input,
        vocabulary,
        rejected,
        'generation',
        log,
      );
      if (!next.ok) {
        log.warn(
          `the regeneration was invalid; keeping round ${round}'s document, with ${keys(rejected)} dropped`,
        );
        // `rounds` counts the generation rounds spent, the invalid one included.
        return this.finalize(current, verdicts, round + 1, true, log);
      }
      const nextAnswers = generatorAnswers(next.assembled.doc, options);
      const { kept, toAsk } = carryVerdicts(verdicts, answers, nextAnswers);
      const fresh = await this.verification.verify(
        next.assembled.doc,
        input,
        vocabulary,
        toAsk,
        log,
      );
      current = next.assembled;
      answers = nextAnswers;
      verdicts = [...kept, ...fresh];
    }
  }

  /**
   * Applies the round's verdicts to the document generated in that round
   * (never to an already finalized one). Every exit is final: a field still
   * rejected here is dropped.
   */
  private finalize(
    assembled: AssembledDocument,
    verdicts: FieldVerdict[],
    round: number,
    regenerationInvalid: boolean,
    log: AttemptLog,
  ): AssembledDocument {
    const doc = applyVerdicts(assembled.doc, verdicts, {
      round,
      final: true,
      regenerationInvalid,
    });
    doc.models.verifier = this.config.decisionModel;
    log.debug(
      `verified in ${round} round${round === 1 ? '' : 's'}${doc.verification.dropped.length ? `, dropped ${doc.verification.dropped.map((d) => d.field).join(', ')}` : ''}`,
    );
    return { ...assembled, doc };
  }
}

const keys = (verdicts: FieldVerdict[]): string =>
  verdicts.map((v) => v.key).join(', ');
