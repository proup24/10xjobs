import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import {
  ExtractionInvalidError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import { DecisionModel, ExtractionModel } from '../models/types';
import { VocabRepository } from '../repositories/vocab.repository';
import type { ListName } from '../vocab/lists';
import {
  type Claim,
  type FinishOutcome,
  type NewAttempt,
  ProcessorRepository,
  type ReuseKey,
} from '../repositories/processor.repository';
import { EXTRACTION_SCHEMA_VERSION, type ExtractionDocument } from '../schema';
import { buildPostingInput, inputHash } from './input';
import { buildDecisionQuestions } from './questions';
import { promptHash } from '../prompts/prompt';
import { deriveTypedColumns } from './typed-columns';
import {
  ExtractionFailed,
  ProcessExtractionService,
  invalidMessage,
} from './process-extraction.service';
import { needsReview } from './validate';

export type ProcessOutcome =
  | 'processed'
  | 'reused'
  | 'closed'
  | 'superseded'
  | 'not_claimed'
  | 'over_budget'
  | 'retry'
  | 'failed'
  | 'provider_unavailable'
  | 'paused';

/** How long this process stops claiming after a key, credit or account error. */
export const PROVIDER_PAUSE_MS = 10 * 60_000;

/** Injectable clock for the budget day; defaults to the system clock. */
export const PROCESSOR_CLOCK = Symbol('PROCESSOR_CLOCK');

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Processes one normalized job end to end (spec §4): budget, claim, reuse,
 * Jev, Opus with one schema-fix retry, resolution, validation, save, finish.
 * Every model call made is recorded as an attempt, whatever the outcome.
 */
@Injectable()
export class ProcessJobService {
  private readonly logger = new Logger(ProcessJobService.name);
  private readonly now: () => Date;
  /** Claiming stops until then after the provider refused the key or account. */
  private pausedUntil = 0;
  /** The UTC day the over-budget warning was last logged. */
  private budgetWarnedDay: number | null = null;
  private readonly extractionFlow: ProcessExtractionService;

  constructor(
    private readonly repo: ProcessorRepository,
    private readonly vocab: VocabRepository,
    decision: DecisionModel,
    extraction: ExtractionModel,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    @Optional() @Inject(PROCESSOR_CLOCK) now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
    this.extractionFlow = new ProcessExtractionService(
      vocab,
      decision,
      extraction,
      config,
    );
  }

  /**
   * The budget is checked before each claim against the spend already
   * logged, so jobs in flight at the same time can overshoot the limit by up
   * to `concurrency - 1` jobs.
   */
  async process(jobId: string): Promise<ProcessOutcome> {
    if (this.isPaused()) return 'paused';

    const day = startOfUtcDay(this.now());
    const spent = await this.repo.spendSince(day);
    if (spent >= this.config.dailyBudgetUsd) {
      if (this.budgetWarnedDay !== day.getTime()) {
        this.budgetWarnedDay = day.getTime();
        this.logger.warn(
          `Daily budget reached (${spent.toFixed(2)} of ${this.config.dailyBudgetUsd} USD); not claiming until the next UTC day`,
        );
      }
      return 'over_budget';
    }

    const claim = await this.repo.claim(jobId);
    if (!claim) return 'not_claimed';

    const attempts: NewAttempt[] = [];
    try {
      return await this.run(claim, attempts);
    } catch (error) {
      try {
        await this.repo.recordAttempts(attempts);
        if (error instanceof ProviderUnavailableError)
          return await this.providerUnavailable(claim, error);
        return await this.fail(claim, error);
      } catch (cleanup) {
        // Recording the attempts or finishing the claim failed too: the job
        // stays `processing`, and the stale sweep returns it to `pending`.
        this.logger.error(
          `Could not end the claim on ${claim.jobId}; the stale sweep will release it`,
          cleanup instanceof Error ? cleanup.stack : String(cleanup),
        );
        throw cleanup;
      }
    }
  }

  /** True while claiming is paused after a key, credit or account error. */
  isPaused(): boolean {
    return this.now().getTime() < this.pausedUntil;
  }

  /**
   * The key, credit or account is the problem, not the job: the job goes back
   * to `pending` with its attempt given back, and claiming pauses here.
   */
  private async providerUnavailable(
    claim: Claim,
    error: ProviderUnavailableError,
  ): Promise<ProcessOutcome> {
    const wasPaused = this.isPaused();
    this.pausedUntil = this.now().getTime() + PROVIDER_PAUSE_MS;
    if (!wasPaused)
      this.logger.error(
        `OpenRouter refused the request (${error.message}); pausing processing for ${PROVIDER_PAUSE_MS / 60_000} minutes. Check the key and the account's credit.`,
      );
    const finished = await this.repo.finish(claim, {
      status: 'pending',
      error: error.message,
      refundAttempt: true,
    });
    return finished === 'superseded' ? 'superseded' : 'provider_unavailable';
  }

  private async run(
    claim: Claim,
    attempts: NewAttempt[],
  ): Promise<ProcessOutcome> {
    const { jobId } = claim;
    const job = await this.repo.loadJob(jobId);
    if (!job)
      return this.end(
        claim,
        { status: 'failed', error: `job ${jobId} not found` },
        'failed',
      );
    if (job.closed)
      return this.end(
        claim,
        { status: 'processed', extractionId: null },
        'closed',
      );

    const input = buildPostingInput(job);
    const vocabulary = await this.vocab.snapshot();
    const key: ReuseKey = {
      inputHash: inputHash(input),
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptHash: promptHash(buildDecisionQuestions(vocabulary.options)),
      decisionModel: this.config.decisionModel,
      extractionModel: this.config.extractionModel,
    };

    const reusable = await this.repo.findReusable(key);
    if (reusable) {
      const extractionId =
        reusable.jobId === jobId
          ? reusable.id
          : await this.repo.copyExtraction(reusable.id, jobId);
      return this.end(claim, { status: 'processed', extractionId }, 'reused');
    }

    const doc = await this.extractionFlow.extract(
      jobId,
      input,
      vocabulary,
      attempts,
    );
    const extractionId = await this.repo.saveExtraction({
      ...key,
      ...deriveTypedColumns(doc, vocabulary.regionCountries),
      jobId,
      data: doc,
      needsReview: needsReview(doc),
      costUsd: attempts.reduce((sum, a) => sum + a.costUsd, 0),
    });
    await this.repo.recordAttempts(
      attempts.map((a) => ({ ...a, extractionId })),
    );
    // Recorded: a later failure must not record them a second time.
    attempts.length = 0;
    for (const [list, codes] of usedCodes(doc))
      await this.vocab.bumpOccurrences(list, codes);
    return this.end(claim, { status: 'processed', extractionId }, 'processed');
  }

  private async fail(claim: Claim, error: unknown): Promise<ProcessOutcome> {
    const message =
      error instanceof ExtractionInvalidError
        ? invalidMessage(error)
        : error instanceof Error
          ? error.message
          : String(error);
    const permanent =
      error instanceof ModelRequestError ||
      error instanceof ExtractionInvalidError ||
      error instanceof ExtractionFailed;
    if (!permanent && claim.attempts < this.config.maxAttempts) {
      if (!(error instanceof TransientModelError))
        this.logger.error(
          `Processing ${claim.jobId} failed unexpectedly; will retry`,
          error instanceof Error ? error.stack : undefined,
        );
      return this.end(claim, { status: 'pending', error: message }, 'retry');
    }
    return this.end(claim, { status: 'failed', error: message }, 'failed');
  }

  private async end(
    claim: Claim,
    outcome: FinishOutcome,
    result: ProcessOutcome,
  ): Promise<ProcessOutcome> {
    const finished = await this.repo.finish(claim, outcome);
    return finished === 'superseded' ? 'superseded' : result;
  }
}

/** Every approved code the document uses, per list; repeats count each time. */
function usedCodes(doc: ExtractionDocument): [ListName, string[]][] {
  const used: Record<string, string[]> = {};
  const add = (list: ListName, code: string | null | undefined) => {
    if (code) (used[list] ??= []).push(code);
  };
  add('seniorities', doc.seniority.value);
  add('arrangements', doc.arrangement.value);
  add('roleKinds', doc.position.value?.roleKind);
  add('contractTypes', doc.contractType.value);
  add('engagements', doc.engagement.value);
  for (const f of doc.junkFlags.value ?? []) add('junkFlags', f.code);
  for (const o of doc.openings) {
    for (const a of o.arrangements) add('arrangements', a);
    for (const p of o.places) {
      if (p.kind === 'region') add('regions', p.code);
      else if (p.kind === 'country') add('countries', p.code);
      else if (p.kind === 'city') add('countries', p.countryCode);
    }
  }
  const stack = doc.techStack.value;
  if (stack) {
    const terms = [
      ...stack.mainStack.flatMap((g) => g.anyOf),
      ...stack.mustHaves.flatMap((g) => g.anyOf),
      ...stack.niceToHaves,
    ];
    for (const t of terms) add('techTags', t.code);
  }
  return Object.entries(used) as [ListName, string[]][];
}
