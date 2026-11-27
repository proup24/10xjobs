import { Logger } from '@nestjs/common';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import { turnsSummary } from '../models/claude/turns';
import type { ModelCallMeta } from '../models/types';
import type { DocType, NewAttempt } from '../repositories/processor.repository';

export type AttemptStep = NewAttempt['step'];

const REASON_MAX = 400;
const clip = (text: string): string =>
  text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text;
const seconds = (ms: number | undefined): string =>
  `${((ms ?? 0) / 1000).toFixed(1)}s`;
const usd = (n: number | undefined): string => `$${(n ?? 0).toFixed(6)}`;
const turns = (meta: Partial<ModelCallMeta> | undefined): string =>
  meta?.turns ? ` · ${turnsSummary(meta.turns)}` : '';

/**
 * One run of the processor: every model call, in order, as
 * `processing_attempts` rows, and the run's execution log. The services
 * append to it as they call models and log their steps through it, so every
 * line of a run carries the same `[job <id>]` (or `[preview]`) prefix. The
 * processor writes the rows once, whatever the run's outcome, so every paid
 * call is counted exactly once.
 *
 * Levels: `log` for the run's progress and each model call, `warn` for an
 * invalid answer or a failed call, `debug` for detail.
 */
export class AttemptLog {
  private static readonly logger = new Logger('Processor');
  private readonly rows: NewAttempt[] = [];
  readonly label: string;

  private readonly docType: DocType;

  /**
   * `jobId` null for a preview, which is not tied to a normalized job.
   * `docType` is written on every entry (default `'listing'`).
   */
  constructor(
    private readonly jobId: string | null,
    options: { docType?: DocType } = {},
  ) {
    this.label = jobId ? `[job ${jobId}]` : '[preview]';
    this.docType = options.docType ?? 'listing';
  }

  info(message: string): void {
    AttemptLog.logger.log(`${this.label} ${message}`);
  }

  warn(message: string): void {
    AttemptLog.logger.warn(`${this.label} ${message}`);
  }

  debug(message: string): void {
    AttemptLog.logger.debug(`${this.label} ${message}`);
  }

  /** Before a model call: a long call then shows what is in flight. */
  calling(step: AttemptStep, model: string, detail: string): void {
    this.info(`${step} → ${model} (${detail})`);
  }

  ok(step: AttemptStep, model: string, meta: ModelCallMeta): void {
    this.push(step, model, meta, 'ok', null);
    this.info(
      `${step} ok in ${seconds(meta.latencyMs)} · ${meta.inputTokens} in / ${meta.outputTokens} out tokens · ${usd(meta.costUsd)}${turns(meta)}`,
    );
  }

  /** The call answered, but its output was unusable. */
  invalid(
    step: AttemptStep,
    model: string,
    meta: Partial<ModelCallMeta> | undefined,
    error: string,
  ): void {
    this.push(step, model, meta, 'invalid', error);
    this.warn(
      `${step} invalid in ${seconds(meta?.latencyMs)} · ${usd(meta?.costUsd)}${turns(meta)}: ${clip(error)}`,
    );
  }

  /** The call failed; the provider's cost, if any, is still counted. */
  failed(step: AttemptStep, model: string, error: unknown): void {
    const meta = metaOf(error);
    this.push(step, model, meta, 'error', messageOf(error));
    this.warn(
      `${step} failed after ${seconds(meta?.latencyMs)}${turns(meta)}: ${clip(messageOf(error))}`,
    );
  }

  /** The last call answered, but the document built from it was invalid. */
  markLastInvalid(error: string): void {
    const last = this.rows.at(-1);
    if (last) Object.assign(last, { outcome: 'invalid', error });
    this.warn(
      `document from ${last?.step ?? 'the call'} rejected: ${clip(error)}`,
    );
  }

  setLastQuoteFailures(count: number): void {
    const last = this.rows.at(-1);
    if (last) last.quoteFailures = count;
  }

  get costUsd(): number {
    return this.rows.reduce((sum, row) => sum + row.costUsd, 0);
  }

  /** The rows to write, tied to the saved extraction when there is one. */
  entries(extractionId: string | null = null): NewAttempt[] {
    return this.rows.map((row) => ({ ...row, extractionId }));
  }

  private push(
    step: AttemptStep,
    model: string,
    meta: Partial<ModelCallMeta> | undefined,
    outcome: NewAttempt['outcome'],
    error: string | null,
  ): void {
    this.rows.push({
      jobId: this.jobId,
      extractionId: null,
      eval: false,
      step,
      outcome,
      error,
      quoteFailures: 0,
      docType: this.docType,
      model: meta?.model ?? model,
      providerRequestId: meta?.providerRequestId ?? null,
      inputTokens: meta?.inputTokens ?? 0,
      outputTokens: meta?.outputTokens ?? 0,
      cachedInputTokens: meta?.cachedInputTokens ?? 0,
      costUsd: meta?.costUsd ?? 0,
      latencyMs: meta?.latencyMs ?? 0,
      turns: meta?.turns ?? null,
    });
  }
}

function metaOf(error: unknown): Partial<ModelCallMeta> | undefined {
  return error instanceof TransientModelError ||
    error instanceof ModelRequestError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ModelOutputError
    ? error.meta
    : undefined;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
