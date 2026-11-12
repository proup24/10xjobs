import { Logger } from '@nestjs/common';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FieldVerdict } from '../rules/verify';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
import { GENERATION_MAX_OUTPUT_TOKENS } from './client';
import {
  AiSdkExtractionModel,
  feedbackMessage,
  openRouterLanguageModel,
} from './extraction.model';
import { ModelPricing } from './pricing';
import type { PostingInput } from './types';

const MODEL = 'anthropic/claude-opus-5.5';

const input: PostingInput = {
  jobId: 'j1',
  title: 'Senior Backend Engineer',
  description: 'Remote in the EU. TypeScript and PostgreSQL.',
  truncated: true,
};

const schema = z.strictObject({
  seniority: z.object({ value: z.enum(['junior', 'senior']).nullable() }),
});
const req = { systemPrompt: 'Extract the facts.', schema };

type DoGenerate = MockLanguageModelV4['doGenerate'];
type GenerateResult = Awaited<ReturnType<DoGenerate>>;

function answer(
  text: string,
  over: Partial<GenerateResult> = {},
): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: {
        total: 1000,
        noCache: 600,
        cacheRead: 400,
        cacheWrite: undefined,
      },
      outputTokens: { total: 200, text: 200, reasoning: undefined },
    },
    warnings: [],
    response: {
      id: 'gen-1',
      modelId: 'anthropic/claude-opus-5.5-20261020',
      timestamp: new Date(0),
    },
    providerMetadata: { openrouter: { usage: { cost: 0.0105 } } },
    ...over,
  };
}

const mock = (doGenerate: DoGenerate | GenerateResult | GenerateResult[]) =>
  new MockLanguageModelV4({ doGenerate });

const apiError = (statusCode: number, body = '') =>
  new APICallError({
    message: `status ${statusCode}`,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody: body,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });

const model = (
  languageModel: MockLanguageModelV4,
  pricing = new ModelPricing(),
) => new AiSdkExtractionModel('key', MODEL, pricing, languageModel);

describe('AiSdkExtractionModel', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('valid object → output and meta with cost from provider metadata', async () => {
    const lm = mock(answer('{"seniority":{"value":"senior"}}'));
    const { output, meta } = await model(lm).generate(input, req);

    expect(output).toEqual({ seniority: { value: 'senior' } });
    expect(meta).toMatchObject({
      model: 'anthropic/claude-opus-5.5-20261020',
      providerRequestId: 'gen-1',
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 400,
      costUsd: 0.0105,
    });
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(lm.doGenerateCalls).toHaveLength(1);
  });

  it('estimates the cost from list prices when the provider reports none', async () => {
    const pricing = new ModelPricing();
    pricing.set(new Map([[MODEL, { prompt: 0.00001, completion: 0.00005 }]]));
    const lm = mock(
      answer('{"seniority":{"value":"senior"}}', { providerMetadata: {} }),
    );
    const { meta } = await model(lm, pricing).generate(input, req);
    expect(meta.costUsd).toBeCloseTo(1000 * 0.00001 + 200 * 0.00005);
  });

  it('sends the system prompt with ephemeral cache control, the posting, and the schema', async () => {
    const lm = mock(answer('{"seniority":{"value":null}}'));
    await model(lm).generate(input, req);

    const call = lm.doGenerateCalls[0];
    expect(call.prompt[0]).toMatchObject({
      role: 'system',
      content: 'Extract the facts.',
      providerOptions: { openrouter: { cacheControl: { type: 'ephemeral' } } },
    });
    expect(JSON.stringify(call.prompt[1])).toContain('Remote in the EU.');
    expect(JSON.stringify(call.prompt[1])).toContain('was truncated');
    expect(call.prompt).toHaveLength(2);
    expect(call.responseFormat).toMatchObject({
      type: 'json',
      name: 'extraction',
      schema: {
        type: 'object',
        required: ['seniority'],
        additionalProperties: false,
      },
    });
  });

  it('the user message has no listing metadata or company line', async () => {
    const lm = mock(answer('{"seniority":{"value":null}}'));
    await model(lm).generate(input, req);
    const message = JSON.stringify(lm.doGenerateCalls[0].prompt[1]);
    expect(message).toContain('Senior Backend Engineer');
    expect(message).not.toContain('Listing metadata');
    expect(message).not.toContain('Company:');
  });

  it('schema-invalid object → ModelOutputError listing paths', async () => {
    const lm = mock(answer('{"seniority":{"value":"wizard"}}'));
    const error = await model(lm)
      .generate(input, req)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as ModelOutputError).message).toContain('seniority.value');
    expect((error as ModelOutputError).meta).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      providerRequestId: 'gen-1',
    });
    expect(lm.doGenerateCalls).toHaveLength(1);
  });

  it('unparseable or cut-off output → ModelOutputError', async () => {
    const notJson = await model(mock(answer('not json')))
      .generate(input, req)
      .catch((e: unknown) => e);
    expect(notJson).toBeInstanceOf(ModelOutputError);
    expect((notJson as Error).message).toContain('not valid JSON');

    const cut = await model(
      mock(
        answer('{"seniority":', {
          finishReason: { unified: 'length', raw: 'length' },
        }),
      ),
    )
      .generate(input, req)
      .catch((e: unknown) => e);
    expect(cut).toBeInstanceOf(ModelOutputError);
    expect((cut as Error).message).toContain('cut off');
  });

  it.each([
    [402, ProviderUnavailableError],
    [401, ProviderUnavailableError],
    [429, TransientModelError],
    [503, TransientModelError],
    [400, ModelRequestError],
  ])('%i APICallError → %o', async (status, Kind) => {
    const lm = mock(async () => {
      throw apiError(status, '{"error":{"message":"nope"}}');
    });
    const error = await model(lm)
      .generate(input, req)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Kind);
    expect((error as Error).message).toContain(`OpenRouter returned ${status}`);
    expect((error as Error).message).toContain('nope');
    expect((error as Error).message).toContain(MODEL);
  });

  it('caps the output tokens so OpenRouter does not reserve the model maximum', async () => {
    const lm = mock(answer('{"seniority":{"value":null}}'));
    await model(lm).generate(input, req);
    expect(lm.doGenerateCalls[0].maxOutputTokens).toBe(
      GENERATION_MAX_OUTPUT_TOKENS,
    );
  });

  it('request sets maxRetries 0: a retryable error is not retried', async () => {
    const lm = mock(async () => {
      throw apiError(503);
    });
    await expect(model(lm).generate(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
    expect(lm.doGenerateCalls).toHaveLength(1);
  });

  it('adds the retry errors and the feedback as separate user messages', async () => {
    const lm = mock(answer('{"seniority":{"value":"senior"}}'));
    const feedback: FieldVerdict[] = [
      {
        key: 'seniority',
        verdict: 'rejected',
        score: 0.91,
        jevPick: 'junior',
        generatorValue: 'senior',
        decidedBy: 'generator',
        round: 1,
      },
    ];
    await model(lm).generate(input, {
      ...req,
      retryErrors: ['seniority.value: Invalid option'],
      feedback,
    });
    const prompt = lm.doGenerateCalls[0].prompt;
    expect(prompt.map((m) => m.role)).toEqual([
      'system',
      'user',
      'user',
      'user',
    ]);
    expect(JSON.stringify(prompt[2])).toContain('re-read');
    expect(JSON.stringify(prompt[3])).toContain(
      'seniority.value: Invalid option',
    );
  });
});

describe('feedbackMessage', () => {
  const verdicts: FieldVerdict[] = [
    {
      key: 'seniority',
      verdict: 'rejected',
      score: 0.91,
      jevPick: 'mid',
      generatorValue: 'senior',
      decidedBy: 'generator',
      round: 1,
    },
    {
      key: 'junk:vague',
      verdict: 'rejected',
      score: 0.85,
      jevPick: 'yes',
      generatorValue: 'no',
      decidedBy: 'generator',
      round: 1,
    },
  ];

  it('feedback renders a message naming the field, the generator value, Jev\'s pick and score, and not "use"/"adopt"', () => {
    const text = feedbackMessage(verdicts);
    expect(text).toContain('seniority');
    expect(text).toContain('What seniority level does the posting ask for?');
    expect(text).toContain('"senior"');
    expect(text).toContain('"mid"');
    expect(text).toContain('0.91');
    expect(text).toContain('vague');
    expect(text).toContain('0.85');
    expect(text).toMatch(/re-read the posting/i);
    expect(text).toContain('unstated');
    expect(text).not.toMatch(/\buse\b/i);
    expect(text).not.toMatch(/\badopt\b/i);
    expect(text).not.toMatch(/\bcopy\b/i);
  });
});

describe('openRouterLanguageModel', () => {
  it('request sets require_parameters and usage accounting, with ephemeral cache control on the system prompt', async () => {
    let body: Record<string, unknown> = {};
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: 'gen-1',
          model: MODEL,
          created: 1,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: '{"seniority":{"value":"senior"}}',
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            cost: 0.002,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const lm = openRouterLanguageModel(
      'key',
      MODEL,
      fetch as unknown as typeof globalThis.fetch,
    );
    const { meta } = await new AiSdkExtractionModel(
      'key',
      MODEL,
      new ModelPricing(),
      lm,
    ).generate(input, req);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      model: MODEL,
      max_tokens: GENERATION_MAX_OUTPUT_TOKENS,
      provider: { require_parameters: true },
      usage: { include: true },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'extraction', strict: true },
      },
    });
    const messages = body.messages as {
      role: string;
      content: unknown;
    }[];
    expect(messages[0]).toMatchObject({
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'Extract the facts.',
          cache_control: { type: 'ephemeral' },
        },
      ],
    });
    expect(body).not.toHaveProperty('temperature');
    expect(meta.costUsd).toBe(0.002);
  });
});
