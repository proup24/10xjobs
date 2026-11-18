import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ProviderUnavailableError, UsageLimitError } from '../models/errors';
import { ExtractionModel } from '../models/types';
import {
  type Claim,
  type FinishOutcome,
  type JobState,
  type ProcessingCounts,
  ProcessorRepository,
} from '../repositories/processor.repository';
import { VocabRepository } from '../repositories/vocab.repository';
import { buildPostingInput } from '../rules/input';
import { deriveTypedColumns, type TypedColumns } from '../rules/typed-columns';
import { needsReview } from '../rules/validate';
import type { ExtractionDocument } from '../schema';
import { AttemptLog } from './attempt-log';
import { ExtractionPipeline } from './extraction-pipeline.service';
import { ExtractionStore } from './extraction-store.service';
import { FactAssembler } from './fact-assembler.service';
import { GenerationService } from './generation.service';
import { decideFailure, type FailureOutcome } from './failure-policy';
import {
  type GuardBlock,
  type PauseState,
  ProcessorGuard,
} from './processor-guard.service';

export type ProcessOutcome =
  | 'processed'
  | 'reused'
  | 'closed'
  | 'superseded'
  | 'not_claimed'
  | GuardBlock
  | FailureOutcome;

/** A posting to preview, as a client would send it. */
export interface PreviewPosting {
  title?: string;
  description: string;
}

export interface PreviewResult {
  document: ExtractionDocument;
  typedColumns: TypedColumns;
  needsReview: boolean;
  costUsd: number;
  calls: {
    step: string;
    model: string;
    outcome: string;
    costUsd: number;
    latencyMs: number;
    error: string | null;
  }[];
}

export interface ProcessorStatus {
  models: { extraction: string };
  jobs: ProcessingCounts;
  estimatedCostTodayUsd: number;
  dailyBudgetUsd: number;
  /** Only this process's pause; another worker process may be paused too. */
  paused: boolean;
  pause: PauseState | null;
  weeklyUtilization: number | null;
}

/** The guard refused to start model calls. */
export class ProcessorBlockedError extends Error {
  constructor(
    readonly reason: GuardBlock,
    pause: PauseState | null = null,
  ) {
    super(
      reason === 'paused'
        ? pause
          ? `Processing is paused until ${pause.until.toISOString()} (${pause.reason}): ${pause.detail}`
          : 'Processing is paused'
        : "Today's processing budget is spent",
    );
    this.name = 'ProcessorBlockedError';
  }
}

/**
 * The processor's single entry point, used by the worker and the HTTP API.
 *
 * Processing one job:
 *   1. ProcessorGuard        may model calls start? (budget, provider pause)
 *   2. claim                 pending → processing, or someone else has it
 *   3. load + reuse          a closed job, or the same input seen before, needs no call
 *   4. ExtractionPipeline    generate (schema-fix retries) → cross-fact checks
 *   5. ExtractionStore       save the extraction, its attempts and vocabulary
 *   6. finish                processed / pending (retry) / failed, per decideFailure
 */
@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);

  constructor(
    private readonly guard: ProcessorGuard,
    private readonly jobs: ProcessorRepository,
    private readonly vocab: VocabRepository,
    private readonly pipeline: ExtractionPipeline,
    private readonly store: ExtractionStore,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  async process(jobId: string): Promise<ProcessOutcome> {
    const blocked = await this.guard.check();
    if (blocked) {
      this.logger.debug(`[job ${jobId}] not started: ${blocked}`);
      return blocked;
    }

    const claim = await this.jobs.claim(jobId);
    if (!claim) {
      this.logger.debug(
        `[job ${jobId}] not claimed: not pending, out of scope, or another worker has it`,
      );
      return 'not_claimed';
    }

    const log = new AttemptLog(jobId);
    const started = Date.now();
    log.info(
      `claimed (attempt ${claim.attempts} of ${this.config.maxAttempts})`,
    );
    try {
      return await this.run(claim, log, started);
    } catch (error) {
      return this.fail(claim, error, log, started);
    }
  }

  /** Sends one in-scope job back to `pending`, then processes it now. */
  async processNow(
    jobId: string,
  ): Promise<{ outcome: ProcessOutcome; job: JobState | null }> {
    await this.jobs.markPending({ jobIds: [jobId] });
    const outcome = await this.process(jobId);
    return { outcome, job: await this.jobs.jobState(jobId) };
  }

  /**
   * Runs the extraction on a posting that is not a stored job, and returns
   * the document. Saves no extraction and no vocabulary; its model calls are
   * still recorded (with no job), so they count against the daily budget.
   */
  async preview(posting: PreviewPosting): Promise<PreviewResult> {
    const blocked = await this.guard.check();
    if (blocked)
      throw new ProcessorBlockedError(blocked, this.guard.pauseState());

    const input = buildPostingInput({
      id: 'preview',
      closed: false,
      title: posting.title ?? null,
      descriptionText: posting.description,
    });
    const vocabulary = await this.vocab.snapshot();
    const log = new AttemptLog(null);
    const started = Date.now();
    log.info(
      `started (${input.description.length} characters${input.truncated ? ', truncated' : ''})`,
    );
    try {
      const { doc } = await this.pipeline.run(input, vocabulary, log);
      log.info(
        `done in ${elapsed(started)} · ${usd(log.costUsd)} · needsReview ${needsReview(doc)}`,
      );
      return {
        document: doc,
        typedColumns: deriveTypedColumns(doc),
        needsReview: needsReview(doc),
        costUsd: log.costUsd,
        calls: log.entries().map((a) => ({
          step: a.step,
          model: a.model,
          outcome: a.outcome,
          costUsd: a.costUsd,
          latencyMs: a.latencyMs,
          error: a.error,
        })),
      };
    } catch (error) {
      log.warn(
        `failed after ${elapsed(started)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof ProviderUnavailableError) this.guard.pause(error);
      if (error instanceof UsageLimitError) this.pauseForLimit(error);
      throw error;
    } finally {
      await this.store.recordAttempts(log);
    }
  }

  jobState(jobId: string): Promise<JobState | null> {
    return this.jobs.jobState(jobId);
  }

  async status(): Promise<ProcessorStatus> {
    return {
      models: {
        extraction: this.config.extractionModel,
      },
      jobs: await this.jobs.processingCounts(),
      estimatedCostTodayUsd: await this.guard.spentToday(),
      dailyBudgetUsd: this.config.dailyBudgetUsd,
      paused: this.guard.isPaused(),
      pause: this.guard.pauseState(),
      weeklyUtilization: this.guard.lastWeeklyUtilization(),
    };
  }

  isPaused(): boolean {
    return this.guard.isPaused();
  }

  private async run(
    claim: Claim,
    log: AttemptLog,
    started: number,
  ): Promise<ProcessOutcome> {
    const job = await this.jobs.loadJob(claim.jobId);
    if (!job) {
      log.warn('the job no longer exists');
      return this.finish(
        claim,
        { status: 'failed', error: `job ${claim.jobId} not found` },
        'failed',
        log,
      );
    }
    if (job.closed) {
      log.info('closed posting: processed with no model call');
      return this.finish(
        claim,
        { status: 'processed', extractionId: null },
        'closed',
        log,
      );
    }

    const input = buildPostingInput(job);
    log.debug(
      `input: "${job.title ?? '(no title)'}", ${input.description.length} characters${input.truncated ? ' (truncated)' : ''}`,
    );
    const vocabulary = await this.vocab.snapshot();
    const key = this.store.reuseKey(input);
    const exact = await this.store.reuse(key, claim.jobId, null);
    const joined =
      exact || claim.reason !== 'joined'
        ? null
        : await this.store.reuse(key, claim.jobId, claim.reason);
    const reused = exact ?? joined;
    if (reused) {
      log.info(
        exact
          ? `reused extraction ${reused}: same input, prompt and models`
          : `reused extraction ${reused}: joined job, same posting`,
      );
      return this.finish(
        claim,
        { status: 'processed', extractionId: reused },
        'reused',
        log,
      );
    }

    const assembled = await this.pipeline.run(input, vocabulary, log);
    const extractionId = await this.store.save(
      claim.jobId,
      key,
      assembled,
      vocabulary,
      log,
    );
    log.info(
      `processed in ${elapsed(started)} · ${usd(log.costUsd)} · extraction ${extractionId}${needsReview(assembled.doc) ? ' · needs review' : ''}`,
    );
    return this.finish(
      claim,
      { status: 'processed', extractionId },
      'processed',
      log,
    );
  }

  private async fail(
    claim: Claim,
    error: unknown,
    log: AttemptLog,
    started: number,
  ): Promise<ProcessOutcome> {
    const decision = decideFailure(
      error,
      claim.attempts,
      this.config.maxAttempts,
    );
    if (decision.unexpected)
      this.logger.error(
        `Processing ${claim.jobId} failed unexpectedly (${decision.outcome})`,
        error instanceof Error ? error.stack : String(error),
      );
    if (error instanceof ProviderUnavailableError) this.guard.pause(error);
    if (error instanceof UsageLimitError) this.pauseForLimit(error);
    const next =
      decision.outcome === 'retry'
        ? `back to pending for a retry (attempt ${claim.attempts} of ${this.config.maxAttempts})`
        : decision.outcome === 'provider_unavailable' ||
            decision.outcome === 'usage_limit'
          ? 'back to pending, attempt given back'
          : 'failed for good';
    log.warn(
      `${next} after ${elapsed(started)} · ${usd(log.costUsd)}: ${decision.finish.status === 'processed' ? '' : decision.finish.error}`,
    );
    try {
      await this.store.recordAttempts(log);
      return await this.finish(claim, decision.finish, decision.outcome, log);
    } catch (cleanup) {
      this.logger.error(
        `Could not end the claim on ${claim.jobId}; the stale sweep will release it`,
        cleanup instanceof Error ? cleanup.stack : String(cleanup),
      );
      throw cleanup;
    }
  }

  private pauseForLimit(error: UsageLimitError): void {
    this.guard.pauseForUsageLimit(error.limit?.resetsAt ?? null, error.message);
  }

  private async finish(
    claim: Claim,
    outcome: FinishOutcome,
    result: ProcessOutcome,
    log: AttemptLog,
  ): Promise<ProcessOutcome> {
    const finished = await this.jobs.finish(claim, outcome);
    if (finished !== 'superseded') return result;
    log.info(
      'superseded: the job was reopened or reclaimed during the run; its new status stands',
    );
    return 'superseded';
  }
}

const elapsed = (started: number): string =>
  `${((Date.now() - started) / 1000).toFixed(1)}s`;
const usd = (n: number): string => `$${n.toFixed(6)}`;

/** Everything the processor needs from outside: storage, models, config. */
export interface ProcessorDependencies {
  repo: ProcessorRepository;
  vocab: VocabRepository;
  extraction: ExtractionModel;
  config: ProcessorConfig;
  now?: () => Date;
  /** A prepared guard, so a test can feed it limit observations. */
  guard?: ProcessorGuard;
}

/** The service graph without Nest, for tests and scripts. */
export function createProcessorService(
  deps: ProcessorDependencies,
): ProcessorService {
  const { repo, vocab, config } = deps;
  return new ProcessorService(
    deps.guard ?? new ProcessorGuard(repo, config, deps.now),
    repo,
    vocab,
    new ExtractionPipeline(
      new GenerationService(deps.extraction, new FactAssembler(), config),
    ),
    new ExtractionStore(repo, vocab, config),
    config,
  );
}
