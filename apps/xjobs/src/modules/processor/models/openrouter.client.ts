import { ModelRequestError, TransientModelError } from './errors';

const BASE_URL = 'https://openrouter.ai';
const CALL_TIMEOUT_MS = 120_000;

export interface PostResult {
  body: Record<string, unknown>;
  latencyMs: number;
}

/** Thin OpenRouter HTTP client: maps statuses to the model error classes. */
export class OpenRouterClient {
  constructor(private readonly apiKey: string) {}

  async postJson(
    path: string,
    body: unknown,
    signal: AbortSignal = AbortSignal.timeout(CALL_TIMEOUT_MS),
  ): Promise<PostResult> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new TransientModelError(
        `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`,
        { latencyMs: Date.now() - started },
      );
    }
    const text = await response.text().catch(() => '');
    const latencyMs = Date.now() - started;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const status = response.status;
    if (!response.ok) {
      const message = `OpenRouter ${path} returned ${status}: ${text.slice(0, 300)}`;
      if (status === 408 || status === 429 || status >= 500)
        throw new TransientModelError(message, { latencyMs });
      throw new ModelRequestError(message, { latencyMs });
    }
    if (typeof parsed !== 'object' || parsed === null)
      throw new TransientModelError(
        `OpenRouter ${path} returned an unparseable body`,
        { latencyMs },
      );
    const record = parsed as Record<string, unknown>;
    if (record.error)
      throw new TransientModelError(
        `OpenRouter ${path} returned an error body: ${JSON.stringify(record.error).slice(0, 300)}`,
        { latencyMs },
      );
    return { body: record, latencyMs };
  }
}

/** Startup check: the extraction model must be listed with `structured_outputs`. */
export async function assertStructuredOutputs(model: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/v1/models`, {
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Could not list OpenRouter models: ${response.status}`);
  const body = (await response.json()) as {
    data?: { id: string; supported_parameters?: string[] }[];
  };
  const entry = body.data?.find((m) => m.id === model);
  if (!entry) throw new Error(`OpenRouter does not list model ${model}`);
  if (!entry.supported_parameters?.includes('structured_outputs'))
    throw new Error(`Model ${model} does not support structured_outputs`);
}
