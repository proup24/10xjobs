import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import type { LimitObservation } from '../models/claude/stream';
import {
  ClaudeAuthError,
  type ProviderUnavailableError,
} from '../models/errors';
import { ProcessorRepository } from '../repositories/processor.repository';

/** How long processing stops after a key, credit or account error. */
export const PROVIDER_PAUSE_MS = 10 * 60_000;

/** How long a usage limit pauses processing when it carries no reset time. */
export const USAGE_LIMIT_FALLBACK_MS = 15 * 60_000;

export type PauseReason = 'auth' | 'usage_limit' | 'weekly_reserve' | 'startup';

export interface PauseState {
  until: Date;
  reason: PauseReason;
  detail: string;
}

/** Injectable clock for the budget day and the pause; the system clock by default. */
export const PROCESSOR_CLOCK = Symbol('PROCESSOR_CLOCK');

export type GuardBlock = 'paused' | 'over_budget' | 'post_cap';

export const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Decides whether model calls may start: not while paused after the provider
 * refused the key or account, and not once today's spend reached the budget.
 * The pause lives in this process only.
 */
@Injectable()
export class ProcessorGuard {
  private readonly logger = new Logger(ProcessorGuard.name);
  private readonly now: () => Date;
  private paused: PauseState | null = null;
  private weeklyUtilization: number | null = null;
  /** The UTC day the over-budget warning was last logged. */
  private budgetWarnedDay: number | null = null;

  constructor(
    private readonly repo: ProcessorRepository,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    @Optional() @Inject(PROCESSOR_CLOCK) now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  /**
   * Null when calls may start. The budget is checked against the spend
   * already logged, so jobs in flight at the same time can overshoot it by up
   * to `concurrency - 1` jobs.
   */
  async check(
    docType: 'listing' | 'post' = 'listing',
  ): Promise<GuardBlock | null> {
    if (this.isPaused()) return 'paused';
    if (await this.overBudget()) return 'over_budget';
    if (docType === 'post' && (await this.postCapReached())) return 'post_cap';
    return null;
  }

  private async overBudget(): Promise<boolean> {
    // A budget of 0 means no cap (the subscription's limits stop first).
    if (this.config.dailyBudgetUsd === 0) return false;
    const day = startOfUtcDay(this.now());
    const spent = await this.repo.spendSince(day);
    if (spent < this.config.dailyBudgetUsd) return false;
    if (this.budgetWarnedDay !== day.getTime()) {
      this.budgetWarnedDay = day.getTime();
      this.logger.warn(
        `Daily budget reached (${spent.toFixed(2)} of ${this.config.dailyBudgetUsd} USD); not processing until the next UTC day`,
      );
    }
    return true;
  }

  /** A cap of 0 pauses post extraction; otherwise today's post calls count. */
  private async postCapReached(): Promise<boolean> {
    const cap = this.config.postDailyCap;
    if (cap === 0) return true;
    const calls = await this.repo.postCallsSince(startOfUtcDay(this.now()));
    return calls >= cap;
  }

  isPaused(): boolean {
    return this.pauseState() !== null;
  }

  /** The current pause, or null when none is in force. */
  pauseState(): PauseState | null {
    if (this.paused && this.now().getTime() >= this.paused.until.getTime())
      this.paused = null;
    return this.paused;
  }

  /** The latest utilization of any weekly limit seen, or null. */
  lastWeeklyUtilization(): number | null {
    return this.weeklyUtilization;
  }

  /**
   * Pauses processing until `until`, keeping the later end of the current and
   * the new pause. Logs only when the end moves later, at `level` when given,
   * else `warn` for limits and `error` for auth and startup.
   */
  pauseUntil(
    until: Date,
    reason: PauseReason,
    detail: string,
    level?: 'log' | 'warn' | 'error',
  ): void {
    const current = this.pauseState();
    if (current && until.getTime() <= current.until.getTime()) return;
    this.paused = { until, reason, detail };
    const line = `Processing paused until ${until.toISOString()} (${reason}): ${detail}`;
    this.logger[
      level ?? (reason === 'auth' || reason === 'startup' ? 'error' : 'warn')
    ](line);
  }

  /** A usage limit was hit: pause until its reset, or 15 minutes when unknown. */
  pauseForUsageLimit(resetsAt: Date | null, detail: string): void {
    this.pauseUntil(
      resetsAt && resetsAt.getTime() > this.now().getTime()
        ? resetsAt
        : new Date(this.now().getTime() + USAGE_LIMIT_FALLBACK_MS),
      'usage_limit',
      detail,
    );
  }

  /** Ends the current pause, only if it was for `reason`. */
  clearPause(reason: PauseReason): void {
    if (this.pauseState()?.reason === reason) this.paused = null;
  }

  /**
   * Reads the limits a call reported. A weekly limit at or above
   * `weeklyStopAt` pauses until its reset; the 5-hour window never pauses on
   * utilization. An observation with no reset time cannot pause.
   */
  observeLimits(observations: LimitObservation[]): void {
    const weekly = observations.filter(
      (o) =>
        (o.kind === 'weekly' || o.kind === 'weekly_sonnet') &&
        o.utilization !== null,
    );
    if (weekly.length === 0) return;
    // The latest batch replaces the stored value, so it falls after a reset.
    this.weeklyUtilization = Math.max(
      ...weekly.map((o) => o.utilization as number),
    );
    for (const o of weekly) {
      const utilization = o.utilization as number;
      // A reset at or before now carries no backoff: treat it as unknown.
      if (
        utilization < this.config.weeklyStopAt ||
        !o.resetsAt ||
        o.resetsAt.getTime() <= this.now().getTime()
      )
        continue;
      const pct = Math.round(utilization * 100);
      this.pauseUntil(
        o.resetsAt,
        'weekly_reserve',
        `the ${o.kind === 'weekly' ? 'weekly' : 'weekly Sonnet'} limit is at ${pct}% (reserve stops at ${Math.round(this.config.weeklyStopAt * 100)}%)`,
      );
    }
  }

  /**
   * Called on a `ProviderUnavailableError`: pauses for ten minutes. A refused
   * credential names the fix; anything else (`claude` could not run, no
   * credential) keeps its own message.
   */
  pause(error: ProviderUnavailableError): void {
    this.pauseUntil(
      new Date(this.now().getTime() + PROVIDER_PAUSE_MS),
      'auth',
      error instanceof ClaudeAuthError
        ? 'Claude refused the credential. Run `claude setup-token`, update the server .env, and restart the worker.'
        : error.message,
    );
  }

  /** Today's logged spend (of one document type, or all), for the status endpoint. */
  async spentToday(docType?: 'listing' | 'post'): Promise<number> {
    return this.repo.spendSince(startOfUtcDay(this.now()), docType);
  }

  /** Today's post extraction calls, for the status endpoint. */
  async postCallsToday(): Promise<number> {
    return this.repo.postCallsSince(startOfUtcDay(this.now()));
  }
}
