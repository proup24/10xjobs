import type {
  DecisionsChoiceQuestion,
  DecisionsNoulQuestion,
  DecisionsResponse,
} from '@openrouter/sdk/models';
import { ModelOutputError } from './errors';
import { type OpenRouterClient, timed } from './openrouter.client';
import { ModelPricing } from './pricing';
import type {
  DecisionAnswer,
  DecisionQuestion,
  ModelCallMeta,
  PostingInput,
} from './types';
import { DecisionModel } from './types';

type ResponseAnswer = DecisionsResponse['answers'][string];

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** The posting as Jev reads it; listing metadata is labelled as context only. */
function statement(input: PostingInput): string {
  return [
    input.title && `Title: ${input.title}`,
    input.companyName && `Company: ${input.companyName}`,
    `Listing metadata (context only): ${JSON.stringify(input.evidence)}`,
    input.description,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildQuestion(
  q: DecisionQuestion,
): DecisionsChoiceQuestion | DecisionsNoulQuestion {
  if (q.kind === 'yesno')
    return {
      type: 'noul',
      instructions: q.instructions,
      criteria: { true: 'Yes.', false: 'No.' },
    };
  return {
    type: 'choice',
    instructions: q.instructions,
    criteria: Object.fromEntries(q.options.map((o) => [o, o])),
  };
}

/**
 * One answer, or `{ value: null, score: 0 }` when it is missing, of another
 * type than asked, or picks an option that was never offered: the caller then
 * sends the question to the extraction model.
 */
function toAnswer(
  q: DecisionQuestion,
  raw: ResponseAnswer | undefined,
): DecisionAnswer {
  const none: DecisionAnswer = { key: q.key, value: null, score: 0 };
  if (q.kind === 'yesno') {
    if (raw?.type !== 'noul' || !finite(raw.noul)) return none;
    // `noul` is the probability of "yes"; the spread from 0.5 is the confidence.
    return {
      key: q.key,
      value: raw.noul >= 0.5,
      score: Math.abs(raw.noul - 0.5) * 2,
    };
  }
  if (raw?.type !== 'choice' || !q.options.includes(raw.choice)) return none;
  const optionScore = raw.probabilities?.[raw.choice];
  const score = finite(raw.confidence)
    ? raw.confidence
    : finite(optionScore)
      ? optionScore
      : 0;
  return { key: q.key, value: raw.choice, score };
}

/** Jev (or any Decisions model) through OpenRouter's Decisions API. */
export class OpenRouterDecisionModel extends DecisionModel {
  constructor(
    private readonly client: OpenRouterClient,
    private readonly model: string,
    private readonly pricing: ModelPricing = new ModelPricing(),
  ) {
    super();
  }

  async decide(
    input: PostingInput,
    questions: DecisionQuestion[],
  ): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta }> {
    const { value: res, latencyMs } = await timed(() =>
      this.client.alpha.decisions.create({
        decisionsRequest: {
          model: this.model,
          state: statement(input),
          questions: Object.fromEntries(
            questions.map((q) => [q.key, buildQuestion(q)]),
          ),
        },
      }),
    );
    const meta: ModelCallMeta = {
      model: res.model,
      providerRequestId: res.id ?? null,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cachedInputTokens: 0,
      // Priced by the configured ID: the reported one may differ.
      costUsd: this.pricing.costOf(this.model, res.usage.cost ?? null, {
        input: res.usage.inputTokens,
        output: res.usage.outputTokens,
      }),
      latencyMs,
    };
    if (Object.keys(res.answers).length === 0)
      throw new ModelOutputError('Decisions API returned no answers', meta);
    return {
      answers: questions.map((q) => toAnswer(q, res.answers[q.key])),
      meta,
    };
  }
}
