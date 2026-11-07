import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ModelOutputError } from '../models/errors';
import {
  type ClosedQuestionKey,
  type DecisionAnswer,
  DecisionModel,
  type PostingInput,
} from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { buildVerificationQuestions } from '../rules/questions';
import { type FieldVerdict, generatorAnswers, judge } from '../rules/verify';
import type { ExtractionDocument } from '../schema';
import type { AttemptLog } from './attempt-log';

/**
 * One verification round (spec §3): Jev answers the closed questions on its
 * own, and each answer is compared with the generator's value. With `keys`,
 * only those fields are asked.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly decision: DecisionModel,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /**
   * Unusable Jev output (`ModelOutputError`, or a missing or unoffered
   * answer) leaves the affected fields `unconfirmed` and is logged `invalid`.
   * Provider and transport failures are thrown.
   */
  async verify(
    doc: ExtractionDocument,
    input: PostingInput,
    vocabulary: Vocabulary,
    keys: Set<ClosedQuestionKey> | undefined,
    log: AttemptLog,
  ): Promise<FieldVerdict[]> {
    const model = this.config.decisionModel;
    const all = generatorAnswers(doc, vocabulary.options);
    const generator = keys
      ? (Object.fromEntries(
          Object.entries(all).filter(([k]) => keys.has(k as ClosedQuestionKey)),
        ) as Record<ClosedQuestionKey, string>)
      : all;
    const questions = buildVerificationQuestions(vocabulary.options, keys);
    if (questions.length === 0) return [];

    let answers: DecisionAnswer[] = [];
    log.calling('verification', model, `${questions.length} questions`);
    try {
      const result = await this.decision.decide(input, questions);
      answers = result.answers;
      const unusable = questions
        .filter((q) => {
          const a = answers.find((x) => x.key === q.key);
          return !a || a.value === null;
        })
        .map((q) => q.key);
      if (unusable.length === 0) log.ok('verification', model, result.meta);
      else
        log.invalid(
          'verification',
          model,
          result.meta,
          `no usable answer for ${unusable.join(', ')}`,
        );
    } catch (error) {
      if (!(error instanceof ModelOutputError)) {
        log.failed('verification', model, error);
        throw error;
      }
      log.invalid('verification', model, error.meta, error.message);
    }

    const verdicts = judge(generator, answers, model);
    const count = (v: FieldVerdict['verdict']) =>
      verdicts.filter((x) => x.verdict === v).length;
    const rejected = verdicts.filter((v) => v.verdict === 'rejected');
    log.debug(
      `Jev: ${count('confirmed')} confirmed, ${count('unconfirmed')} unconfirmed, ${rejected.length} rejected${rejected.length ? ` (${rejected.map((v) => `${v.key}: ${v.generatorValue} → ${v.jevPick}`).join(', ')})` : ''}`,
    );
    return verdicts;
  }
}
