import {
  ConnectionError,
  OpenRouterError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
} from '@openrouter/sdk/models/errors';
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

  it('keeps the latency and never copies the response body', () => {
    const mapped = toModelError(httpError(400), 42) as ModelRequestError;
    expect(mapped.meta).toEqual({ latencyMs: 42 });
    expect(mapped.message).toContain('400');
    expect(mapped.message).not.toContain('nope');
  });
});

describe('timed', () => {
  it('returns the value with its latency', async () => {
    const { value, latencyMs } = await timed(async () => 7);
    expect(value).toBe(7);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
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

  it('refuses an extraction model without numeric pricing', async () => {
    await expect(
      checkModels(
        listed([{ ...opus, pricing: { prompt: '', completion: 'x' } }]),
        { decisionModel: 'typesafe/jev-1.14', extractionModel: opus.id },
      ),
    ).rejects.toThrow(/pricing/);
  });
});
