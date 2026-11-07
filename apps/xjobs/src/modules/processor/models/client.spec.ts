import {
  ConnectionError,
  OpenRouterError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
} from '@openrouter/sdk/models/errors';
import { APICallError, InvalidPromptError } from 'ai';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
import {
  assertApiKey,
  checkModels,
  type OpenRouterClient,
  timed,
  toModelError,
} from './client';

function httpError(status: number): OpenRouterError {
  return new OpenRouterError(`status ${status}`, {
    response: new Response('{"error":{"code":1,"message":"nope"}}', {
      status,
    }),
    request: new Request('https://openrouter.ai/api/v1/chat/completions'),
    body: '{"error":{"code":1,"message":"nope"}}',
  });
}

function listed(
  models: {
    id: string;
    supportedParameters?: string[];
    pricing?: { prompt: string; completion: string };
  }[],
): OpenRouterClient {
  return {
    apiKeys: { getCurrentKeyMetadata: vi.fn(async () => ({}) as never) },
    models: {
      list: vi.fn(async () => ({
        result: {
          data: models.map((m) => ({
            supportedParameters: [],
            pricing: { prompt: '0', completion: '0' },
            ...m,
          })),
        },
      })),
    },
  } as unknown as OpenRouterClient;
}

describe('toModelError', () => {
  it.each([401, 402, 403])('%i means the provider is unavailable', (s) => {
    expect(toModelError(httpError(s), 5)).toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it.each([408, 429, 500, 502, 503, 524, 529])('%i is transient', (s) => {
    expect(toModelError(httpError(s), 5)).toBeInstanceOf(TransientModelError);
  });

  it.each([400, 404, 413, 422])('%i is a request error', (s) => {
    expect(toModelError(httpError(s), 5)).toBeInstanceOf(ModelRequestError);
  });

  it('maps the AI SDK APICallError by status, with the reason', () => {
    const sdk = (statusCode?: number) =>
      new APICallError({
        message: 'failed',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        requestBodyValues: {},
        statusCode,
        responseBody: '{"error":{"message":"nope"}}',
      });
    expect(toModelError(sdk(402), 5)).toBeInstanceOf(ProviderUnavailableError);
    expect(toModelError(sdk(503), 5)).toBeInstanceOf(TransientModelError);
    const bad = toModelError(sdk(422), 5);
    expect(bad).toBeInstanceOf(ModelRequestError);
    expect(bad.message).toBe('OpenRouter returned 422: nope');
    // No status: the request never got an answer.
    expect(toModelError(sdk(undefined), 5)).toBeInstanceOf(
      TransientModelError,
    );
  });

  it('treats a prompt the AI SDK refuses to send as a request error', () => {
    const error = new InvalidPromptError({ prompt: {}, message: 'bad' });
    expect(toModelError(error, 5)).toBeInstanceOf(ModelRequestError);
  });

  it('treats a connection closed mid-response (undici "terminated") as transient', () => {
    const terminated = new TypeError('terminated');
    const mapped = toModelError(terminated, 120_000);
    expect(mapped).toBeInstanceOf(TransientModelError);
    expect(mapped.message).toBe('OpenRouter call failed: terminated');
    expect((mapped as TransientModelError).meta).toEqual({
      latencyMs: 120_000,
    });
  });

  it('treats any other failure of the call itself as transient', () => {
    expect(toModelError(new Error('fetch failed'), 5)).toBeInstanceOf(
      TransientModelError,
    );
    expect(toModelError('socket hang up', 5)).toBeInstanceOf(
      TransientModelError,
    );
  });

  it('treats network failures and timeouts as transient', () => {
    expect(toModelError(new ConnectionError('reset'), 5)).toBeInstanceOf(
      TransientModelError,
    );
    expect(toModelError(new RequestTimeoutError('slow'), 5)).toBeInstanceOf(
      TransientModelError,
    );
  });

  it('treats a response the SDK cannot read as an output error', () => {
    const error = new ResponseValidationError('bad shape', {
      response: new Response('{}', { status: 200 }),
      request: new Request('https://openrouter.ai/api/alpha/decisions'),
      body: '{}',
      cause: new Error('zod'),
      rawValue: {},
      rawMessage: 'bad shape',
    });
    expect(toModelError(error, 5)).toBeInstanceOf(ModelOutputError);
  });

  it('treats a request the SDK refuses to send as a request error', () => {
    const error = new SDKValidationError('bad input', new Error('zod'), {});
    expect(toModelError(error, 5)).toBeInstanceOf(ModelRequestError);
  });

  it('keeps the latency', () => {
    const mapped = toModelError(httpError(400), 42) as ModelRequestError;
    expect(mapped.meta).toEqual({ latencyMs: 42 });
  });

  it("carries OpenRouter's reason, so a rejected request can be diagnosed", () => {
    const body = JSON.stringify({
      error: {
        code: 422,
        message: 'Provider returned error',
        metadata: {
          provider_name: 'DeepInfra',
          raw: 'response_format: unsupported keyword "pattern" at properties.salary',
        },
      },
    });
    const mapped = toModelError(
      new OpenRouterError('status 422', {
        response: new Response(body, { status: 422 }),
        request: new Request('https://openrouter.ai/api/v1/chat/completions'),
        body,
      }),
      5,
    );
    expect(mapped).toBeInstanceOf(ModelRequestError);
    expect(mapped.message).toBe(
      'OpenRouter returned 422: Provider returned error [DeepInfra] response_format: unsupported keyword "pattern" at properties.salary',
    );
  });

  it('truncates a long reason and survives a body that is not JSON', () => {
    const long = JSON.stringify({ error: { message: 'x'.repeat(2000) } });
    const mapped = toModelError(
      new OpenRouterError('status 400', {
        response: new Response(long, { status: 400 }),
        request: new Request('https://openrouter.ai/api/v1/chat/completions'),
        body: long,
      }),
      5,
    );
    expect(mapped.message.length).toBeLessThanOrEqual(600);

    const html = toModelError(
      new OpenRouterError('status 502', {
        response: new Response('<html>bad gateway</html>', { status: 502 }),
        request: new Request('https://openrouter.ai/api/v1/chat/completions'),
        body: '<html>bad gateway</html>',
      }),
      5,
    );
    expect(html.message).toBe('OpenRouter returned 502');
  });
});

describe('timed', () => {
  it('returns the value with its latency', async () => {
    const { value, latencyMs } = await timed(async () => 7);
    expect(value).toBe(7);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('names the call that failed', async () => {
    await expect(
      timed(async () => {
        throw httpError(422);
      }, 'chat completions (deepseek/x)'),
    ).rejects.toThrow(
      /^chat completions \(deepseek\/x\): OpenRouter returned 422/,
    );
  });

  it('maps a thrown SDK error', async () => {
    await expect(
      timed(async () => {
        throw httpError(429);
      }),
    ).rejects.toBeInstanceOf(TransientModelError);
  });
});

describe('assertApiKey', () => {
  it('fails startup when the key is rejected', async () => {
    const client = listed([]);
    vi.mocked(client.apiKeys.getCurrentKeyMetadata).mockRejectedValue(
      httpError(401),
    );
    await expect(assertApiKey(client)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('passes with an accepted key', async () => {
    await expect(assertApiKey(listed([]))).resolves.toBeUndefined();
  });
});

describe('checkModels', () => {
  const opus = {
    id: 'anthropic/claude-opus-5.5',
    supportedParameters: ['structured_outputs', 'response_format'],
    pricing: { prompt: '0.000004', completion: '0.00002' },
  };

  it('prices the extraction model and needs no listing for the decision model', async () => {
    const prices = await checkModels(listed([opus]), {
      decisionModel: 'typesafe/jev-1.14',
      extractionModel: opus.id,
    });
    expect(prices.get(opus.id)).toEqual({
      prompt: 0.000004,
      completion: 0.00002,
    });
    expect(prices.has('typesafe/jev-1.14')).toBe(false);
  });

  it('also prices the decision model when OpenRouter lists it', async () => {
    const jev = {
      id: 'typesafe/jev-1.14',
      pricing: { prompt: '0.00000004', completion: '0' },
    };
    const prices = await checkModels(listed([opus, jev]), {
      decisionModel: jev.id,
      extractionModel: opus.id,
    });
    expect(prices.get(jev.id)).toEqual({ prompt: 0.00000004, completion: 0 });
  });

  it('refuses an unlisted extraction model', async () => {
    await expect(
      checkModels(listed([]), {
        decisionModel: 'typesafe/jev-1.14',
        extractionModel: opus.id,
      }),
    ).rejects.toThrow(/does not list/);
  });

  it('refuses an extraction model without structured outputs', async () => {
    await expect(
      checkModels(listed([{ ...opus, supportedParameters: [] }]), {
        decisionModel: 'typesafe/jev-1.14',
        extractionModel: opus.id,
      }),
    ).rejects.toThrow(/structured_outputs/);
  });

  it('refuses an extraction model without response_format', async () => {
    await expect(
      checkModels(
        listed([{ ...opus, supportedParameters: ['structured_outputs'] }]),
        {
          decisionModel: 'typesafe/jev-1.14',
          extractionModel: opus.id,
        },
      ),
    ).rejects.toThrow(/response_format/);
  });

  it('refuses an extraction model without numeric pricing', async () => {
    await expect(
      checkModels(
        listed([{ ...opus, pricing: { prompt: '', completion: 'x' } }]),
        { decisionModel: 'typesafe/jev-1.14', extractionModel: opus.id },
      ),
    ).rejects.toThrow(/pricing/);
  });
});
