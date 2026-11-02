import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelOutputError,
  ModelRequestError,
  TransientModelError,
} from './errors';
import { assertStructuredOutputs, OpenRouterClient } from './openrouter.client';
import { OpenRouterExtractionModel } from './openrouter-extraction.model';
import type { PostingInput } from './types';

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

const input: PostingInput = {
  jobId: 'j1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: 'Build NestJS services.',
  truncated: false,
  evidence: {
    location: null,
    contractType: null,
    experienceLevel: null,
    salary: null,
  },
};
const req = { systemPrompt: 'Extract.', jsonSchema: { type: 'object' } };

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const model = () =>
  new OpenRouterExtractionModel(
    new OpenRouterClient('key'),
    'anthropic/claude-opus-5.5',
  );

describe('OpenRouterExtractionModel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the parsed output and call meta', async () => {
    stubFetch(fixture('extraction-ok.json'));
    const { output, meta } = await model().extract(input, req);
    expect(output).toEqual({
      locations: [
        { kind: 'country', code: 'DE' },
        { kind: 'country', code: 'FR' },
      ],
    });
    expect(meta).toMatchObject({
      model: 'anthropic/claude-opus-5.5-20261001',
      providerRequestId: 'gen-hand-written-1',
      inputTokens: 1200,
      outputTokens: 40,
      cachedInputTokens: 1000,
      costUsd: 0.0153,
    });
  });

  it('sends strict structured output, caching, temperature 0 and retry errors', async () => {
    const fetchMock = stubFetch(fixture('extraction-ok.json'));
    await model().extract(input, { ...req, retryErrors: ['bad code XX'] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const sent = JSON.parse(init.body as string);
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.provider.require_parameters).toBe(true);
    expect(sent.temperature).toBe(0);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content[0].cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(sent.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(sent.messages.at(-1).content).toContain('bad code XX');
  });

  it('throws an output error on finish_reason length, carrying cost', async () => {
    stubFetch(fixture('extraction-length.json'));
    const error = await model()
      .extract(input, req)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as ModelOutputError).meta?.costUsd).toBe(0.09);
  });

  it('throws an output error on unparseable JSON', async () => {
    stubFetch(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'nope' } }],
      }),
    );
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      ModelOutputError,
    );
  });

  it('throws a transient error on empty choices', async () => {
    stubFetch(fixture('extraction-empty.json'));
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });

  it('throws a transient error on an error body with a 200', async () => {
    stubFetch(fixture('error-429.json'));
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });

  it('classifies a 200 error body by its code', async () => {
    stubFetch('{"error":{"code":401,"message":"no key"}}');
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      ModelRequestError,
    );
    stubFetch('{"error":{"code":502,"message":"upstream"}}');
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });

  it('keeps body excerpts out of error messages', async () => {
    stubFetch(
      '{"error":{"code":400,"message":"bad"},"echo":"SECRET-POSTING"}',
      400,
    );
    const error = (await model()
      .extract(input, req)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('400');
    expect(error.message).not.toContain('SECRET-POSTING');
  });

  it('throws a transient error when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });

  it('throws a request error on 400 and a transient error on 503', async () => {
    stubFetch('{"error":{"message":"bad"}}', 400);
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      ModelRequestError,
    );
    stubFetch('{}', 503);
    await expect(model().extract(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });
});

describe('assertStructuredOutputs', () => {
  afterEach(() => vi.unstubAllGlobals());
  const list = (data: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data }))),
    );

  it('passes when the model supports structured_outputs', async () => {
    list([{ id: 'm/x', supported_parameters: ['structured_outputs'] }]);
    await expect(assertStructuredOutputs('m/x')).resolves.toBeUndefined();
  });

  it('throws without structured_outputs', async () => {
    list([{ id: 'm/x', supported_parameters: ['tools'] }]);
    await expect(assertStructuredOutputs('m/x')).rejects.toThrow(
      /structured_outputs/,
    );
  });

  it('throws when the model is not listed', async () => {
    list([]);
    await expect(assertStructuredOutputs('m/x')).rejects.toThrow(/m\/x/);
  });
});
