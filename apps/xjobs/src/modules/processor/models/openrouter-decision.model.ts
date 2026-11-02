import { ModelOutputError } from './errors';
import { OpenRouterClient } from './openrouter.client';
import type {
  DecisionAnswer,
  DecisionQuestion,
  ModelCallMeta,
  PostingInput,
} from './types';
import { DecisionModel } from './types';

interface RawAnswer {
  type?: string;
  selected?: unknown;
  probabilities?: Record<string, number>;
  probability?: number;
  confidence?: number;
}

/**
 * The only place that reads Decisions API response fields.
 * Field names from the docs; confirm against the spike fixtures (models/SPIKE.md).
 */
export function mapDecisionResponse(body: Record<string, unknown>): {
  answers: Record<string, RawAnswer>;
  id: string | null;
  model: string | null;
  costUsd: number;
} {
  const usage = (body.usage ?? {}) as { cost?: number };
  return {
    answers: (body.answers ?? {}) as Record<string, RawAnswer>,
    id: typeof body.id === 'string' ? body.id : null,
    model: typeof body.model === 'string' ? body.model : null,
    costUsd: usage.cost ?? 0,
  };
}

function statement(input: PostingInput): string {
  return [
    input.title && `Title: ${input.title}`,
    input.companyName && `Company: ${input.companyName}`,
    input.description,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildQuestion(q: DecisionQuestion): unknown {
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

function toAnswer(
  q: DecisionQuestion,
  raw: RawAnswer | undefined,
): DecisionAnswer {
  const none: DecisionAnswer = { key: q.key, value: null, score: 0 };
  if (!raw) return none;
  if (q.kind === 'yesno') {
    const p = raw.probability;
    if (typeof p !== 'number') return none;
    return { key: q.key, value: p >= 0.5, score: Math.abs(p - 0.5) * 2 };
  }
  const selected = raw.selected;
  if (typeof selected !== 'string' || !q.options.includes(selected))
    return none;
  const score = raw.confidence ?? raw.probabilities?.[selected] ?? 0;
  return { key: q.key, value: selected, score };
}

export class OpenRouterDecisionModel extends DecisionModel {
  constructor(
    private readonly client: OpenRouterClient,
    private readonly model: string,
  ) {
    super();
  }

  async decide(
    input: PostingInput,
    questions: DecisionQuestion[],
  ): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta }> {
    const { body, latencyMs } = await this.client.postJson(
      '/api/alpha/decisions',
      {
        model: this.model,
        state: statement(input),
        questions: Object.fromEntries(
          questions.map((q) => [q.key, buildQuestion(q)]),
        ),
      },
    );
    const mapped = mapDecisionResponse(body);
    const meta: ModelCallMeta = {
      model: mapped.model ?? this.model,
      providerRequestId: mapped.id,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: mapped.costUsd,
      latencyMs,
    };
    if (Object.keys(mapped.answers).length === 0)
      throw new ModelOutputError('Decisions API returned no answers', meta);
    return {
      answers: questions.map((q) => toAnswer(q, mapped.answers[q.key])),
      meta,
    };
  }
}
