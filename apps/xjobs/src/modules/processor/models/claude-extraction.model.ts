import { zodErrors } from '../schema/errors';
import { ClaudeRunner } from './claude/runner';
import {
  classify,
  type ClaudeResult,
  type LimitObservation,
  parseStream,
} from './claude/stream';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from './errors';
import { postingText, retryText, strictJsonSchema } from './posting';
import type { GenerateRequest, ModelCallMeta, PostingInput } from './types';
import { ExtractionModel } from './types';

/** The generator through `claude -p` (a Claude subscription, no per-token billing). */
export class ClaudeExtractionModel extends ExtractionModel {
  constructor(
    private readonly runner: ClaudeRunner,
    private readonly model: string,
    private readonly opts: { effort: string; timeoutMs: number },
    private readonly onLimits: (obs: LimitObservation[]) => void,
  ) {
    super();
  }

  /**
   * One call, never retried here. Every failure carries the call's partial
   * meta; `onLimits` sees every rate-limit observation once the child ran.
   */
  async generate(
    input: PostingInput,
    req: GenerateRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    const userMessage = req.retryErrors?.length
      ? `${postingText(input)}\n\n${retryText(req.retryErrors)}`
      : postingText(input);
    let run: Awaited<ReturnType<ClaudeRunner['run']>>;
    try {
      run = await this.runner.run({
        model: this.model,
        systemPrompt: req.systemPrompt,
        userMessage,
        jsonSchema: strictJsonSchema(req.schema),
        effort: this.opts.effort,
        timeoutMs: this.opts.timeoutMs,
      });
    } catch (error) {
      throw new ProviderUnavailableError(
        `claude could not be started: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = parseStream(run.stdout);
    this.onLimits(parsed.limits);
    const meta = this.meta(parsed.result, run.latencyMs);
    const failure = classify(parsed, run);
    if (failure) {
      switch (failure.kind) {
        case 'usage_limit':
          throw new UsageLimitError(
            'claude usage limit reached',
            failure.limit,
            meta,
          );
        case 'auth':
          throw new ProviderUnavailableError(
            'claude authentication failed',
            meta,
          );
        case 'transient':
          throw new TransientModelError(failure.reason, meta);
        case 'request':
          throw new ModelRequestError(failure.reason, meta);
        case 'output':
          throw new ModelOutputError(failure.reason, meta);
      }
    }

    const checked = req.schema.safeParse(parsed.result?.structuredOutput);
    if (!checked.success)
      throw new ModelOutputError(
        `Extraction did not match the schema: ${zodErrors(checked.error).join('; ')}`,
        meta,
      );
    return { output: checked.data, meta };
  }

  private meta(result: ClaudeResult | null, latencyMs: number): ModelCallMeta {
    return {
      model: result?.model ?? this.model,
      providerRequestId: result?.sessionId ?? null,
      inputTokens: result?.usage.input ?? 0,
      outputTokens: result?.usage.output ?? 0,
      cachedInputTokens: result?.usage.cachedInput ?? 0,
      costUsd: result?.costUsd ?? 0,
      latencyMs,
    };
  }
}

/**
 * The generator as the worker, the operator endpoints and the processor
 * scripts all build it: one `claude -p` turn per call (`--max-turns 1`).
 */
export function createClaudeExtractionModel(opts: {
  model: string;
  effort: string;
  timeoutMs: number;
  bin?: string;
  onLimits?: (obs: LimitObservation[]) => void;
}): ClaudeExtractionModel {
  return new ClaudeExtractionModel(
    new ClaudeRunner({ bin: opts.bin, maxTurns: 1 }),
    opts.model,
    { effort: opts.effort, timeoutMs: opts.timeoutMs },
    opts.onLimits ?? (() => undefined),
  );
}
