import type { ChatMessages } from '@openrouter/sdk/models';
import { ModelOutputError, TransientModelError } from './errors';
import { type OpenRouterClient, timed } from './client';
import { ModelPricing } from './pricing';
import type { ModelCallMeta, PostingInput } from './types';
import { ExtractionModel } from './types';

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

function messages(
  input: PostingInput,
  req: { systemPrompt: string; retryErrors?: string[] },
): ChatMessages[] {
  const list: ChatMessages[] = [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: req.systemPrompt,
          cacheControl: { type: 'ephemeral' },
        },
      ],
    },
    { role: 'user', content: postingText(input) },
  ];
  if (req.retryErrors?.length)
    list.push({
      role: 'user',
      content: `Your previous answer was invalid. Fix these problems and answer again:\n${req.retryErrors.map((e) => `- ${e}`).join('\n')}`,
    });
  return list;
}

/** An extraction model (Opus by default) through OpenRouter chat completions. */
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
    const { value: res, latencyMs } = await timed(() =>
      this.client.chat.send({
        chatRequest: {
          model: this.model,
          stream: false,
          temperature: 0,
          messages: messages(input, req),
          responseFormat: {
            type: 'json_schema',
            jsonSchema: {
              name: 'extraction',
              strict: true,
              schema: req.jsonSchema as Record<string, unknown>,
            },
          },
          // Never route to a provider that would ignore the schema.
          provider: { requireParameters: true },
        },
      }),
    );
    const usage = res.usage;
    const inputTokens = usage?.promptTokens ?? 0;
    const outputTokens = usage?.completionTokens ?? 0;
    const meta: ModelCallMeta = {
      model: res.model,
      providerRequestId: res.id,
      inputTokens,
      outputTokens,
      cachedInputTokens: usage?.promptTokensDetails?.cachedTokens ?? 0,
      // Priced by the configured ID: the reported one may carry a date suffix.
      costUsd: this.pricing.costOf(this.model, usage?.cost ?? null, {
        input: inputTokens,
        output: outputTokens,
      }),
      latencyMs,
    };
    const choice = res.choices[0];
    if (!choice)
      throw new TransientModelError('OpenRouter returned empty choices', meta);
    if (choice.finishReason === 'length')
      throw new ModelOutputError('Extraction was cut off (length)', meta);
    const content = choice.message.content;
    if (typeof content !== 'string' || content === '')
      throw new ModelOutputError('Extraction was empty', meta);
    try {
      return { output: JSON.parse(content) as unknown, meta };
    } catch {
      throw new ModelOutputError('Extraction is not valid JSON', meta);
    }
  }
}
