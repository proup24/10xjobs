import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ModelOutputError } from '../models/errors';
import {
  type DecisionAnswer,
  DecisionModel,
  type DecisionQuestion,
  type PostingInput,
} from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { buildDecisionQuestions } from '../rules/questions';
import { selectFallback } from '../rules/resolve-facts';
import type { AttemptLog } from './attempt-log';

/** What Jev answered, and the questions left for the extraction model. */
export interface Decisions {
  answers: DecisionAnswer[];
  /** Low-confidence or evidence-contradicting questions, answered by Opus. */
  fallback: DecisionQuestion[];
  /** The model that answered, as the provider reported it. */
  model: string;
}

/** Step 1: the closed questions, asked to the decision model (Jev). */
@Injectable()
export class DecisionService {
  constructor(
    private readonly decision: DecisionModel,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /**
   * Unusable Jev output costs money, never accuracy: every question then goes
   * to the extraction model. Any other failure ends the run.
   */
  async ask(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<Decisions> {
    const model = this.config.decisionModel;
    const questions = buildDecisionQuestions(vocabulary.options);
    let answers: DecisionAnswer[] = [];
    let reported = model;
    log.calling('decision', model, `${questions.length} questions`);
    try {
      const result = await this.decision.decide(input, questions);
      log.ok('decision', model, result.meta);
      answers = result.answers;
      reported = result.meta.model;
    } catch (error) {
      if (!(error instanceof ModelOutputError)) {
        log.failed('decision', model, error);
        throw error;
      }
      log.invalid('decision', model, error.meta, error.message);
    }
    const fallback = selectFallback(answers, questions, input.evidence, model);
    log.debug(
      fallback.length === 0
        ? 'Jev answered every question confidently'
        : `${fallback.length} of ${questions.length} questions go to the extraction model: ${fallback.map((q) => q.key).join(', ')}`,
    );
    return { answers, fallback, model: reported };
  }
}
