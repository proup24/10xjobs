import { ModelOutputError, TransientModelError } from './errors';
import { OpenRouterClient } from './openrouter.client';
import { ModelPricing } from './pricing';
import type { ModelCallMeta, PostingInput } from './types';
import { ExtractionModel } from './types';

/**
 * The only place that reads chat-completion response fields (OpenAI shape).
 * Field names from the docs; confirm against the spike fixtures (models/SPIKE.md).
 */
export function mapCompletionResponse(
  body: Record<string, unknown>,
  fallbackModel: string,
  latencyMs: number,
): {
  content: string | null;
  finishReason: string | null;
  hasChoices: boolean;
  /** Null when the response carries no numeric `usage.cost`. */
  cost: number | null;
  meta: ModelCallMeta;
} {
  const choices = body.choices as
    | { message?: { content?: string | null }; finish_reason?: string }[]
    | undefined;
  const usage = (body.usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cost?: unknown;
  };
  const cost =
    typeof usage.cost === 'number' && Number.isFinite(usage.cost)
      ? usage.cost
      : null;
  return {
    cost,
    hasChoices: Array.isArray(choices) && choices.length > 0,
    content: choices?.[0]?.message?.content ?? null,
    finishReason: choices?.[0]?.finish_reason ?? null,
    meta: {
      model: typeof body.model === 'string' ? body.model : fallbackModel,
      providerRequestId: typeof body.id === 'string' ? body.id : null,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      costUsd: cost ?? 0,
      latencyMs,
    },
  };
}

function postingText(input: PostingInput): string {
  return [
    input.title && `Title: ${input.title}`,
    input.companyName && `Company: ${input.companyName}`,
    `Listing metadata (context only): ${JSON.stringify(input.evidence)}`,
    input.truncated && 'Note: the description was truncated.',
    input.description,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export class OpenRouterExtractionModel extends ExtractionModel {
  constructor(
    private readonly client: OpenRouterClient,
    private readonly model: string,
    private readonly pricing: ModelPricing = new ModelPricing(),
  ) {
    super();
  }

  async extract(
    input: PostingInput,
    req: { systemPrompt: string; jsonSchema: object; retryErrors?: string[] },
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    const messages: unknown[] = [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: req.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      { role: 'user', content: postingText(input) },
    ];
    if (req.retryErrors?.length)
      messages.push({
        role: 'user',
        content: `Your previous answer was invalid. Fix these problems and answer again:\n${req.retryErrors.map((e) => `- ${e}`).join('\n')}`,
      });
    const { body, latencyMs } = await this.client.postJson(
      '/api/v1/chat/completions',
      {
        model: this.model,
        temperature: 0,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extraction',
            strict: true,
            schema: req.jsonSchema,
          },
        },
        provider: { require_parameters: true },
        usage: { include: true },
      },
    );
    const { content, finishReason, hasChoices, cost, meta } =
      mapCompletionResponse(body, this.model, latencyMs);
    // Priced by the configured ID: the reported one may carry a date suffix.
    meta.costUsd = this.pricing.costOf(this.model, cost, {
      input: meta.inputTokens,
      output: meta.outputTokens,
    });
    if (!hasChoices)
      throw new TransientModelError('OpenRouter returned empty choices', meta);
    if (finishReason === 'length')
      throw new ModelOutputError('Extraction was cut off (length)', meta);
    if (!content) throw new ModelOutputError('Extraction was empty', meta);
    try {
      return { output: JSON.parse(content) as unknown, meta };
    } catch {
      throw new ModelOutputError('Extraction is not valid JSON', meta);
    }
  }
}
