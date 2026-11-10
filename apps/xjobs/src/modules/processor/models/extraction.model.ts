import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  generateText,
  jsonSchema,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type Schema,
  type SystemModelMessage,
} from 'ai';
import { z } from 'zod';
import { instructionsFor } from '../rules/questions';
import type { FieldVerdict } from '../rules/verify';
import { zodErrors } from '../schema/errors';
import { flattenForStrict } from '../schema/model-output';
import {
  CALL_TIMEOUT_MS,
  GENERATION_MAX_OUTPUT_TOKENS,
  toModelError,
} from './client';
import { ModelOutputError } from './errors';
import { ModelPricing } from './pricing';
import type { GenerateRequest, ModelCallMeta, PostingInput } from './types';
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

/** Where each verified field lives in the document, for the feedback message. */
function fieldName(key: FieldVerdict['key']): string {
  if (key.startsWith('junk:'))
    return `junkFlags (the flag ${key.slice('junk:'.length)})`;
  switch (key) {
    case 'roleKind':
      return 'position.value.roleKind';
    case 'sponsorshipOffered':
      return 'workAuthorization.value.sponsorship';
    default:
      return `${key}.value`;
  }
}

const score = (s: number | null): string =>
  s === null ? 'no score' : `score ${s.toFixed(2)}`;

/**
 * The regeneration feedback (spec §2): per field the reviewer rejected, its
 * question, the generator's last value, the reviewer's own reading and its
 * score. It asks for a fresh reading of the posting, never for the reviewer's
 * reading: the reviewer judges, it does not write values.
 */
export function feedbackMessage(feedback: FieldVerdict[]): string {
  const lines = feedback.map(
    (v) =>
      `- ${fieldName(v.key)}. Question: "${instructionsFor(v.key)}" Your answer: "${v.generatorValue}". The reviewer's reading: "${v.jevPick ?? 'none'}" (${score(v.score)}).`,
  );
  return [
    'An independent reviewer read the same posting and disagreed with some of your answers. The reviewer can be wrong too.',
    'For each field below, re-read the posting and answer it again from the posting text alone, with a verbatim quote. Keep your answer when the posting supports it. When the posting does not state the fact, `unstated` (or null) is a valid answer.',
    '',
    ...lines,
  ].join('\n');
}

/** The system prompt, cached (it is the same for every posting). */
const instructions = (systemPrompt: string): SystemModelMessage => ({
  role: 'system',
  content: systemPrompt,
  providerOptions: { openrouter: { cacheControl: { type: 'ephemeral' } } },
});

/** The posting, then the regeneration feedback and the retry errors, each its own message. */
function messages(input: PostingInput, req: GenerateRequest): ModelMessage[] {
  const list: ModelMessage[] = [{ role: 'user', content: postingText(input) }];
  if (req.feedback?.length)
    list.push({ role: 'user', content: feedbackMessage(req.feedback) });
  if (req.retryErrors?.length)
    list.push({
      role: 'user',
      content: `Your previous answer was invalid. Fix these problems and answer again:\n${req.retryErrors.map((e) => `- ${e}`).join('\n')}`,
    });
  return list;
}

/** What the SDK sends and validates, kept for as long as the Zod schema lives. */
const sendable = new WeakMap<z.ZodType, Schema<unknown>>();

/**
 * The JSON Schema made acceptable to strict structured output
 * (`flattenForStrict`), validated locally with the full Zod schema, so a
 * dropped keyword still fails the answer, as a `NoObjectGeneratedError`.
 */
function schemaFor(schema: z.ZodType): Schema<unknown> {
  let out = sendable.get(schema);
  if (!out) {
    out = jsonSchema(
      flattenForStrict(z.toJSONSchema(schema)) as Parameters<
        typeof jsonSchema
      >[0],
      {
        validate: (value) => {
          const parsed = schema.safeParse(value);
          return parsed.success
            ? { success: true, value: parsed.data }
            : { success: false, error: parsed.error };
        },
      },
    );
    sendable.set(schema, out);
  }
  return out;
}

/**
 * The OpenRouter chat model the generator calls: usage accounting on (the
 * response then reports its cost), and routing only to providers that
 * support every parameter sent, so no route ignores the schema.
 */
export function openRouterLanguageModel(
  apiKey: string,
  model: string,
  fetch?: typeof globalThis.fetch,
): LanguageModel {
  return createOpenRouter({
    apiKey,
    appName: 'xjobs',
    compatibility: 'strict',
    ...(fetch ? { fetch } : {}),
  }).chat(model, {
    usage: { include: true },
    provider: { require_parameters: true },
  });
}

function zodIssues(error: unknown): string[] | null {
  for (let e = error; e instanceof Error; e = e.cause)
    if (e instanceof z.ZodError) return zodErrors(e);
  return null;
}

/** The generator (Opus or DeepSeek) through the AI SDK and OpenRouter. */
export class AiSdkExtractionModel extends ExtractionModel {
  private readonly languageModel: LanguageModel;

  /** `languageModel` replaces the OpenRouter model, for tests. */
  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly pricing: ModelPricing = new ModelPricing(),
    languageModel?: LanguageModel,
  ) {
    super();
    this.languageModel =
      languageModel ?? openRouterLanguageModel(apiKey, model);
  }

  /**
   * One structured-output call. Transport retries are off: the processor's
   * failure policy owns them, and a hidden retry would spend outside the log.
   * Unparseable, cut-off or schema-invalid output throws `ModelOutputError`
   * with the call's meta.
   */
  async generate(
    input: PostingInput,
    req: GenerateRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    const started = Date.now();
    const label = `generation (${this.model})`;
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: this.languageModel,
        // No `temperature`: Opus 5.5 does not take it, and with
        // `require_parameters` any unsupported parameter leaves no provider
        // (404). Every parameter sent must be in EXTRACTION_PARAMETERS.
        maxRetries: 0,
        maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
        timeout: CALL_TIMEOUT_MS,
        instructions: instructions(req.systemPrompt),
        messages: messages(input, req),
        output: Output.object({
          name: 'extraction',
          schema: schemaFor(req.schema),
        }),
      });
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (NoObjectGeneratedError.isInstance(error))
        throw new ModelOutputError(
          outputProblem(error),
          this.meta(error.usage, error.response, null, latencyMs),
        );
      const mapped = toModelError(error, latencyMs);
      mapped.message = `${label}: ${mapped.message}`;
      throw mapped;
    }
    const meta = this.meta(
      result.usage,
      result.response,
      reportedCost(result.providerMetadata),
      Date.now() - started,
    );
    try {
      return { output: result.output, meta };
    } catch (error) {
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      throw new ModelOutputError(
        `Extraction was empty or cut off (${result.finishReason})`,
        meta,
      );
    }
  }

  private meta(
    usage: LanguageModelUsage | undefined,
    response: { id?: string; modelId?: string } | undefined,
    cost: number | null,
    latencyMs: number,
  ): ModelCallMeta {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    return {
      model: response?.modelId ?? this.model,
      providerRequestId: response?.id ?? null,
      inputTokens,
      outputTokens,
      cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
      // Priced by the configured ID: the reported one may carry a date suffix.
      costUsd: this.pricing.costOf(this.model, cost, {
        input: inputTokens,
        output: outputTokens,
      }),
      latencyMs,
    };
  }
}

/** OpenRouter's cost, from usage accounting; null when it is not a number. */
function reportedCost(metadata: unknown): number | null {
  const cost = (
    metadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined
  )?.openrouter?.usage?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
}

function outputProblem(error: NoObjectGeneratedError): string {
  if (error.finishReason === 'length') return 'Extraction was cut off (length)';
  const issues = zodIssues(error);
  if (issues)
    return `Extraction did not match the schema: ${issues.join('; ')}`;
  if (!error.text) return 'Extraction was empty';
  return 'Extraction is not valid JSON';
}
