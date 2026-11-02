import type { ChatResult } from '@openrouter/sdk/models';
import type { SendChatCompletionRequestRequest } from '@openrouter/sdk/models/operations';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { Logger } from '@nestjs/common';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
import { OpenRouterExtractionModel } from './extraction.model';
import type { OpenRouterClient } from './client';
import { ModelPricing } from './pricing';
import type { PostingInput } from './types';

const MODEL = 'anthropic/claude-opus-5.5';

const input: PostingInput = {
  jobId: 'j1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: 'Remote in the EU. TypeScript and PostgreSQL.',
  truncated: true,
  evidence: {
    location: 'Paris, France',
    contractType: 'Full-time',
    experienceLevel: 'Mid-Senior level',
    salary: null,
  },
};

const req = {
  systemPrompt: 'Extract the facts.',
  jsonSchema: { type: 'object', additionalProperties: false },
};

function result(
  over: {
    content?: string | null;
    finishReason?: 'stop' | 'length' | null;
    choices?: ChatResult['choices'];
    usage?: ChatResult['usage'];
  } = {},
): ChatResult {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    created: 1,
    model: 'anthropic/claude-opus-5.5-20261020',
    systemFingerprint: null,
    choices: over.choices ?? [
      {
        index: 0,
        finishReason:
          over.finishReason === undefined ? 'stop' : over.finishReason,
        message: {
          role: 'assistant',
          content: over.content === undefined ? '{"ok":true}' : over.content,
        },
      },
    ],
    usage:
      'usage' in over
        ? over.usage
        : {
            promptTokens: 1200,
            completionTokens: 300,
            totalTokens: 1500,
            promptTokensDetails: { cachedTokens: 1000 },
            cost: 0.0105,
          },
  } as ChatResult;
}

function client(answer: ChatResult | Error) {
  const send = vi.fn(async (_req: SendChatCompletionRequestRequest) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    send,
    client: { chat: { send } } as unknown as OpenRouterClient,
  };
}

function httpError(status: number) {
  return new OpenRouterError(`status ${status}`, {
    response: new Response('{"error":{"message":"posting text here"}}', {
      status,
    }),
    request: new Request('https://openrouter.ai/api/v1/chat/completions'),
    body: '{"error":{"message":"posting text here"}}',
  });
}

describe('OpenRouterExtractionModel', () => {
  it('returns the parsed output and the call meta', async () => {
    const { output, meta } = await new OpenRouterExtractionModel(
      client(result()).client,
      MODEL,
    ).extract(input, req);

    expect(output).toEqual({ ok: true });
    expect(meta).toMatchObject({
      model: 'anthropic/claude-opus-5.5-20261020',
      providerRequestId: 'gen-1',
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 1000,
      costUsd: 0.0105,
    });
  });

  it('sends strict structured output, a cached system prompt, temperature 0 and no streaming', async () => {
    const fake = client(result());
    await new OpenRouterExtractionModel(fake.client, MODEL).extract(input, req);

    const { chatRequest } = fake.send.mock.calls[0]![0];
    expect(chatRequest).toMatchObject({
      model: MODEL,
      temperature: 0,
      stream: false,
      provider: { requireParameters: true },
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'extraction',
          strict: true,
          schema: req.jsonSchema,
        },
      },
    });
    expect(chatRequest.messages[0]).toEqual({
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'Extract the facts.',
          cacheControl: { type: 'ephemeral' },
        },
      ],
    });
    const user = chatRequest.messages[1] as { role: string; content: string };
    expect(user.role).toBe('user');
    expect(user.content).toContain('Listing metadata (context only):');
    expect(user.content).toContain('the description was truncated');
    expect(chatRequest.messages).toHaveLength(2);
  });

  it('appends the validation errors of a schema-fix retry as a last user message', async () => {
    const fake = client(result());
    await new OpenRouterExtractionModel(fake.client, MODEL).extract(input, {
      ...req,
      retryErrors: ['openings.0.places: required'],
    });
    const last = fake.send.mock.calls[0]![0].chatRequest.messages.at(-1) as {
      role: string;
      content: string;
    };
    expect(last.role).toBe('user');
    expect(last.content).toContain('- openings.0.places: required');
  });

  it('throws an output error, with the call cost, when the answer was cut off', async () => {
    const error = await new OpenRouterExtractionModel(
      client(result({ finishReason: 'length' })).client,
      MODEL,
    )
      .extract(input, req)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as ModelOutputError).meta?.costUsd).toBe(0.0105);
  });

  it('throws an output error on empty or unparseable content', async () => {
    for (const content of [null, '', '{not json']) {
      await expect(
        new OpenRouterExtractionModel(
          client(result({ content })).client,
          MODEL,
        ).extract(input, req),
      ).rejects.toBeInstanceOf(ModelOutputError);
    }
  });

  it('throws a transient error on empty choices', async () => {
    await expect(
      new OpenRouterExtractionModel(
        client(result({ choices: [] })).client,
        MODEL,
      ).extract(input, req),
    ).rejects.toBeInstanceOf(TransientModelError);
  });

  it('estimates a missing cost from tokens and list prices, warning once', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const pricing = new ModelPricing();
    pricing.set(new Map([[MODEL, { prompt: 0.000004, completion: 0.00002 }]]));
    const noCost = result({
      usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 },
    });
    const model = new OpenRouterExtractionModel(
      client(noCost).client,
      MODEL,
      pricing,
    );
    const first = await model.extract(input, req);
    await model.extract(input, req);

    expect(first.meta.costUsd).toBeCloseTo(0.006, 10);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('maps provider failures without copying the response body', async () => {
    const unavailable = await new OpenRouterExtractionModel(
      client(httpError(401)).client,
      MODEL,
    )
      .extract(input, req)
      .catch((e: unknown) => e);
    expect(unavailable).toBeInstanceOf(ProviderUnavailableError);

    const bad = await new OpenRouterExtractionModel(
      client(httpError(400)).client,
      MODEL,
    )
      .extract(input, req)
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ModelRequestError);
    expect((bad as Error).message).not.toContain('posting text');

    await expect(
      new OpenRouterExtractionModel(
        client(httpError(529)).client,
        MODEL,
      ).extract(input, req),
    ).rejects.toBeInstanceOf(TransientModelError);
  });
});
