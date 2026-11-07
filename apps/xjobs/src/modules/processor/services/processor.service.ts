import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ProviderUnavailableError } from '../models/errors';
import { DecisionModel, type Evidence, ExtractionModel } from '../models/types';
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
import { ExtractionService } from './extraction.service';
import { ExtractionStore } from './extraction-store.service';
import { FactAssembler } from './fact-assembler.service';
import { decideFailure, type FailureOutcome } from './failure-policy';
import { type GuardBlock, ProcessorGuard } from './processor-guard.service';

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
  title?: string | null;
  companyName?: string | null;
  description: string;
  evidence?: Partial<Evidence>;
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
  models: { decision: string; extraction: string };
  jobs: ProcessingCounts;
  spentTodayUsd: number;
  dailyBudgetUsd: number;
  /** Only this process's pause; another worker process may be paused too. */
  paused: boolean;
}

/** The guard refused to start model calls. */
export class ProcessorBlockedError extends Error {
  constructor(readonly reason: GuardBlock) {
    super(
      reason === 'paused'
        ? 'Processing is paused after the provider refused the key or account'
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
 *   4. ExtractionPipeline    generator → checks, into one document
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
    if (blocked) throw new ProcessorBlockedError(blocked);

    const input = buildPostingInput({
      id: 'preview',
      closed: false,
      title: posting.title ?? null,
      companyName: posting.companyName ?? null,
      descriptionText: posting.description,
      evidence: {
        location: null,
        contractType: null,
        experienceLevel: null,
        salary: null,
        ...posting.evidence,
      },
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
        typedColumns: deriveTypedColumns(doc, vocabulary.regionCountries),
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
      if (error instanceof ProviderUnavailableError)
        this.guard.pause(error.message);
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
        decision: this.config.decisionModel,
        extraction: this.config.extractionModel,
      },
      jobs: await this.jobs.processingCounts(),
      spentTodayUsd: await this.guard.spentToday(),
      dailyBudgetUsd: this.config.dailyBudgetUsd,
      paused: this.guard.isPaused(),
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
      `input: "${job.title ?? '(no title)'}" at ${job.companyName ?? '(no company)'}, ${input.description.length} characters${input.truncated ? ' (truncated)' : ''}, LinkedIn ${JSON.stringify(input.evidence)}`,
    );
    const vocabulary = await this.vocab.snapshot();
    const key = this.store.reuseKey(input, vocabulary);
    const reused = await this.store.reuse(key, claim.jobId);
    if (reused) {
      log.info(`reused extraction ${reused}: same input, prompt and models`);
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
    if (error instanceof ProviderUnavailableError)
      this.guard.pause(error.message);
    const next =
      decision.outcome === 'retry'
        ? `back to pending for a retry (attempt ${claim.attempts} of ${this.config.maxAttempts})`
        : decision.outcome === 'provider_unavailable'
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
  decision: DecisionModel;
  extraction: ExtractionModel;
  config: ProcessorConfig;
  now?: () => Date;
}

/** The service graph without Nest, for tests and scripts. */
export function createProcessorService(
  deps: ProcessorDependencies,
): ProcessorService {
  const { repo, vocab, config } = deps;
  return new ProcessorService(
    new ProcessorGuard(repo, config, deps.now),
    repo,
    vocab,
    new ExtractionPipeline(
      new ExtractionService(deps.extraction, config),
      new FactAssembler(),
    ),
    new ExtractionStore(repo, vocab, config),
    config,
  );
}
