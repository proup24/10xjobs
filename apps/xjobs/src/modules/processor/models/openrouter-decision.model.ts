import { ModelOutputError } from './errors';
import { OpenRouterClient } from './openrouter.client';
import type {
  DecisionAnswer,
  DecisionQuestion,
  ModelCallMeta,
  PostingInput,
} from './types';
import { DecisionModel } from './types';

interface MappedAnswer {
  selected: string | boolean | null;
  probability: number | null;
  confidence: number | null;
  optionScores: Record<string, number> | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function finiteScores(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/**
 * The only place that reads Decisions API response fields.
 * Field names from the docs; confirm against the spike fixtures (models/SPIKE.md).
 */
export function mapDecisionResponse(body: Record<string, unknown>): {
  answers: Record<string, MappedAnswer>;
  requestId: string | null;
  model: string | null;
  cost: number;
} {
  const usage = (body.usage ?? {}) as { cost?: unknown };
  const rawAnswers =
    body.answers && typeof body.answers === 'object'
      ? (body.answers as Record<string, unknown>)
      : {};
  const answers: Record<string, MappedAnswer> = {};
  for (const [key, value] of Object.entries(rawAnswers)) {
    // A non-object entry counts as a missing answer.
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    const selected = raw.selected;
    answers[key] = {
      selected:
        typeof selected === 'string' || typeof selected === 'boolean'
          ? selected
          : null,
      probability: num(raw.probability),
      confidence: num(raw.confidence),
      optionScores: finiteScores(raw.probabilities),
    };
  }
  return {
    answers,
    requestId: typeof body.id === 'string' ? body.id : null,
    model: typeof body.model === 'string' ? body.model : null,
    cost: num(usage.cost) ?? 0,
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
  raw: MappedAnswer | undefined,
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
  const score = raw.confidence ?? raw.optionScores?.[selected] ?? 0;
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
      providerRequestId: mapped.requestId,
      // Token counts are 0: the Decisions API bills input tokens only and
      // reports cost directly (confirm with the spike).
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: mapped.cost,
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
