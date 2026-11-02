import { OpenRouter } from '@openrouter/sdk';
import {
  ConnectionError,
  HTTPClientError,
  InvalidRequestError,
  OpenRouterError,
  RequestAbortedError,
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
import type { Price } from './pricing';

const CALL_TIMEOUT_MS = 120_000;
/** Key, credit or account problems: no job can succeed until a human acts. */
const PROVIDER_UNAVAILABLE = new Set([401, 402, 403]);

/** Injection token for the processor's {@link OpenRouterClient}. */
export const OPENROUTER_CLIENT = Symbol('OPENROUTER_CLIENT');

/** The parts of the SDK client the processor uses; tests fake exactly these. */
export type OpenRouterClient = Pick<
  OpenRouter,
  'alpha' | 'chat' | 'models' | 'apiKeys'
>;

/**
 * The SDK client for the processor. The SDK's own retries are off: the
 * processor's retry rules (BullMQ backoff, attempt counting, the provider
 * pause) decide what happens after a failed call.
 */
export function createOpenRouterClient(apiKey: string): OpenRouterClient {
  return new OpenRouter({
    apiKey,
    appTitle: 'xjobs',
    timeoutMs: CALL_TIMEOUT_MS,
    retryConfig: { strategy: 'none' },
  });
}

/**
 * Maps an SDK failure to the processor's error classes. Messages carry the
 * status only, never a response body, so posting text never reaches logs.
 */
export function toModelError(error: unknown, latencyMs: number): Error {
  const meta = { latencyMs };
  // Checked before OpenRouterError: it extends it, with the 2xx status of a
  // response the SDK could not read.
  if (error instanceof ResponseValidationError)
    return new ModelOutputError(
      'OpenRouter returned an unreadable response',
      meta,
    );
  if (error instanceof OpenRouterError) {
    const status = error.statusCode;
    const message = `OpenRouter returned ${status}`;
    if (PROVIDER_UNAVAILABLE.has(status))
      return new ProviderUnavailableError(message, meta);
    if (status === 408 || status === 429 || status >= 500)
      return new TransientModelError(message, meta);
    return new ModelRequestError(message, meta);
  }
  if (
    error instanceof SDKValidationError ||
    error instanceof InvalidRequestError
  )
    return new ModelRequestError(
      `OpenRouter request rejected before sending: ${error.message}`,
      meta,
    );
  if (
    error instanceof ConnectionError ||
    error instanceof RequestTimeoutError ||
    error instanceof RequestAbortedError ||
    error instanceof HTTPClientError
  )
    return new TransientModelError(
      `OpenRouter call failed: ${error.message}`,
      meta,
    );
  if (error instanceof Error) return error;
  return new TransientModelError(
    `OpenRouter call failed: ${String(error)}`,
    meta,
  );
}

/** Runs one SDK call, measuring its latency and mapping its failure. */
export async function timed<T>(
  call: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  try {
    const value = await call();
    return { value, latencyMs: Date.now() - started };
  } catch (error) {
    throw toModelError(error, Date.now() - started);
  }
}

/** Startup check: the key is accepted. A rejected key fails startup, not every job. */
export async function assertApiKey(client: OpenRouterClient): Promise<void> {
  try {
    await client.apiKeys.getCurrentKeyMetadata();
  } catch (error) {
    const status =
      error instanceof OpenRouterError ? ` (${error.statusCode})` : '';
    throw new Error(`OpenRouter rejected OPENROUTER_API_KEY${status}`);
  }
}

/** USD per token from a listed price (OpenRouter sends decimal strings). */
function perToken(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Startup check of the configured models, returning their list prices.
 *
 * The extraction model must be listed, support `structured_outputs`, and have
 * numeric prices (to estimate a call whose response reports no cost). The
 * decision model is served by the Decisions API and may not be in the public
 * list; its responses report `usage.cost`, so it is priced only when listed.
 */
export async function checkModels(
  client: OpenRouterClient,
  config: { decisionModel: string; extractionModel: string },
): Promise<Map<string, Price>> {
  const listed = (await client.models.list()).result.data;
  const find = (id: string) => listed.find((m) => m.id === id);
  const price = (id: string): Price | null => {
    const entry = find(id);
    const prompt = perToken(entry?.pricing.prompt);
    const completion = perToken(entry?.pricing.completion);
    return prompt === null || completion === null
      ? null
      : { prompt, completion };
  };

  const extraction = find(config.extractionModel);
  if (!extraction)
    throw new Error(`OpenRouter does not list model ${config.extractionModel}`);
  if (!extraction.supportedParameters.includes('structured_outputs'))
    throw new Error(
      `Model ${config.extractionModel} does not support structured_outputs`,
    );
  const extractionPrice = price(config.extractionModel);
  if (!extractionPrice)
    throw new Error(
      `OpenRouter lists no numeric pricing for model ${config.extractionModel}`,
    );

  const prices = new Map([[config.extractionModel, extractionPrice]]);
  const decisionPrice = price(config.decisionModel);
  if (decisionPrice) prices.set(config.decisionModel, decisionPrice);
  return prices;
}
