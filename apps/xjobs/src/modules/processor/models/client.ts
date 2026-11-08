import { OpenRouter } from '@openrouter/sdk';
import {
  APICallError,
  InvalidPromptError,
  UnsupportedFunctionalityError,
} from 'ai';
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

/** Per model call, for both SDKs. */
export const CALL_TIMEOUT_MS = 120_000;
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

const REASON_MAX = 250;

const clip = (text: string): string =>
  text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text;

/**
 * OpenRouter's reason for a failed call, from its error body: the message,
 * the provider, and the provider's own (`metadata.raw`) reason, which is
 * where a rejected schema or parameter is named. Each part is clipped; a
 * body that is not JSON gives no reason.
 */
function reasonOf(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '';
  }
  const error = (parsed as { error?: unknown })?.error;
  if (!error || typeof error !== 'object') return '';
  const { message, metadata } = error as {
    message?: unknown;
    metadata?: { provider_name?: unknown; raw?: unknown } | null;
  };
  const raw =
    typeof metadata?.raw === 'string'
      ? metadata.raw
      : metadata?.raw === undefined
        ? undefined
        : JSON.stringify(metadata.raw);
  const parts = [
    typeof message === 'string' ? clip(message) : null,
    typeof metadata?.provider_name === 'string'
      ? `[${metadata.provider_name}]`
      : null,
    raw ? clip(raw) : null,
  ].filter(Boolean);
  return parts.length > 0 ? `: ${parts.join(' ')}` : '';
}

/**
 * Maps an SDK failure to the processor's error classes. The message carries
 * the status and OpenRouter's reason (clipped), which may quote part of the
 * request; that is the price of being able to diagnose a rejected call.
 */
export function toModelError(error: unknown, latencyMs: number): Error {
  const meta = { latencyMs };
  // The AI SDK's HTTP failure (the generator). No status means the request
  // never got an answer: a network failure, retried like one.
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === undefined)
      return new TransientModelError(
        `OpenRouter call failed: ${error.message}`,
        meta,
      );
    return byStatus(status, reasonOf(error.responseBody ?? ''), meta);
  }
  // Checked before OpenRouterError: it extends it, with the 2xx status of a
  // response the SDK could not read.
  if (error instanceof ResponseValidationError)
    return new ModelOutputError(
      'OpenRouter returned an unreadable response',
      meta,
    );
  if (error instanceof OpenRouterError)
    return byStatus(error.statusCode, reasonOf(error.body), meta);
  if (
    error instanceof SDKValidationError ||
    error instanceof InvalidRequestError ||
    InvalidPromptError.isInstance(error) ||
    UnsupportedFunctionalityError.isInstance(error)
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
  // Anything else came from the transport under the SDK: a connection closed
  // mid-response (undici's `TypeError: terminated`), `fetch failed`, a reset.
  // Worth a retry, never a bug in the job.
  return new TransientModelError(
    `OpenRouter call failed: ${error instanceof Error ? error.message : String(error)}`,
    meta,
  );
}

/** 401/402/403 provider unavailable, 408/429/5xx transient, any other status a request error. */
function byStatus(
  status: number,
  reason: string,
  meta: { latencyMs: number },
): Error {
  const message = `OpenRouter returned ${status}${reason}`;
  if (PROVIDER_UNAVAILABLE.has(status))
    return new ProviderUnavailableError(message, meta);
  if (status === 408 || status === 429 || status >= 500)
    return new TransientModelError(message, meta);
  return new ModelRequestError(message, meta);
}

/**
 * Runs one SDK call, measuring its latency and mapping its failure. `label`
 * names the call in the error (`Decisions API (typesafe/jev-1.14): ...`), so a
 * job's error says which model call failed.
 */
export async function timed<T>(
  call: () => Promise<T>,
  label?: string,
): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  try {
    const value = await call();
    return { value, latencyMs: Date.now() - started };
  } catch (error) {
    const mapped = toModelError(error, Date.now() - started);
    if (label && mapped !== error)
      mapped.message = `${label}: ${mapped.message}`;
    throw mapped;
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
 * The OpenRouter parameters the extraction request sends. It routes with
 * `requireParameters`, so the model must support every one or no provider
 * serves the call.
 */
export const EXTRACTION_PARAMETERS = [
  'response_format',
  'structured_outputs',
] as const;

/**
 * Startup check of the configured models, returning their list prices.
 *
 * The extraction model must be listed, support every parameter in
 * {@link EXTRACTION_PARAMETERS}, and have
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
  const missing = EXTRACTION_PARAMETERS.filter(
    (p) => !extraction.supportedParameters.includes(p),
  );
  if (missing.length > 0)
    throw new Error(
      `Model ${config.extractionModel} does not support ${missing.join(', ')}`,
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
