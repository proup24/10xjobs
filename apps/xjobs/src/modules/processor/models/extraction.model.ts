import type { ChatMessages } from '@openrouter/sdk/models';
import { z } from 'zod';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
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

/** Calls per `extract`: the first answer and up to two schema-fix retries. */
export const EXTRACTION_MAX_ATTEMPTS = 3;

type ExtractRequest = {
  systemPrompt: string;
  jsonSchema: object;
  retryErrors?: string[];
};

/** Validators built from a JSON Schema, kept for as long as the schema object lives. */
const validators = new WeakMap<object, z.ZodType>();

function validatorFor(jsonSchema: object): z.ZodType {
  let validator = validators.get(jsonSchema);
  if (!validator) {
    validator = z.fromJSONSchema(
      jsonSchema as Parameters<typeof z.fromJSONSchema>[0],
    );
    validators.set(jsonSchema, validator);
  }
  return validator;
}

const schemaErrors = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

/** Adds up the calls of one `extract`: tokens, cost and time are what they all spent. */
function sumMeta(
  total: ModelCallMeta | undefined,
  next: ModelCallMeta,
): ModelCallMeta {
  if (!total) return next;
  return {
    model: next.model,
    providerRequestId: next.providerRequestId,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cachedInputTokens: total.cachedInputTokens + next.cachedInputTokens,
    costUsd: total.costUsd + next.costUsd,
    latencyMs: total.latencyMs + next.latencyMs,
  };
}

/** Rethrows a provider or request failure with the cost of the earlier attempts added. */
function withSpent(error: unknown, spent: ModelCallMeta | undefined): unknown {
  if (!spent) return error;
  for (const Kind of [
    TransientModelError,
    ProviderUnavailableError,
    ModelRequestError,
  ]) {
    if (error instanceof Kind) {
      const own = error.meta ?? {};
      const merged = sumMeta(spent, {
        model: own.model ?? spent.model,
        providerRequestId: own.providerRequestId ?? null,
        inputTokens: own.inputTokens ?? 0,
        outputTokens: own.outputTokens ?? 0,
        cachedInputTokens: own.cachedInputTokens ?? 0,
        costUsd: own.costUsd ?? 0,
        latencyMs: own.latencyMs ?? 0,
      });
      const wrapped = new Kind(error.message, merged);
      wrapped.stack = error.stack;
      return wrapped;
    }
  }
  return error;
}

/** An extraction model (Opus by default) through OpenRouter chat completions. */
export class OpenRouterExtractionModel extends ExtractionModel {
  constructor(
    private readonly client: OpenRouterClient,
    private readonly model: string,
    private readonly pricing: ModelPricing = new ModelPricing(),
    private readonly maxAttempts: number = EXTRACTION_MAX_ATTEMPTS,
  ) {
    super();
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
      throw new Error(
        `maxAttempts must be a positive integer, got ${maxAttempts}`,
      );
  }

  /**
   * Returns output that matches `req.jsonSchema`. An answer that is cut off,
   * empty, not JSON or off-schema is sent back with its errors, up to
   * `maxAttempts` calls in all; after that a `ModelOutputError` is thrown.
   * The returned (or thrown) meta adds up every call made.
   */
  async extract(
    input: PostingInput,
    req: ExtractRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    const validator = validatorFor(req.jsonSchema);
    let retryErrors = req.retryErrors;
    let spent: ModelCallMeta | undefined;
    let lastErrors: string[] = [];
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let call: { output: unknown; meta: ModelCallMeta };
      try {
        call = await this.callOnce(input, {
          ...req,
          ...(retryErrors ? { retryErrors } : {}),
        });
      } catch (error) {
        if (!(error instanceof ModelOutputError)) throw withSpent(error, spent);
        spent = sumMeta(spent, error.meta as ModelCallMeta);
        lastErrors = [error.message];
        retryErrors = lastErrors;
        continue;
      }
      spent = sumMeta(spent, call.meta);
      const parsed = validator.safeParse(call.output);
      if (parsed.success) return { output: call.output, meta: spent };
      lastErrors = schemaErrors(parsed.error);
      retryErrors = lastErrors;
    }
    throw new ModelOutputError(
      `Extraction did not match the schema after ${this.maxAttempts} attempts: ${lastErrors.join('; ')}`,
      spent,
    );
  }

  /** One chat completion: parsed JSON, or a `ModelOutputError` carrying the call meta. */
  private async callOnce(
    input: PostingInput,
    req: ExtractRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    const { value: res, latencyMs } = await timed(
      () =>
        this.client.chat.send({
          chatRequest: {
            model: this.model,
            stream: false,
            // No `temperature`: Opus 5.5 does not take it, and with
            // `requireParameters` any unsupported parameter leaves no provider
            // (404). Every parameter sent must be in EXTRACTION_PARAMETERS.
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
      `chat completions (${this.model})`,
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
