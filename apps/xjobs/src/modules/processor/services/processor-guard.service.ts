import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import type { LimitObservation } from '../models/claude/stream';
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

export type GuardBlock = 'paused' | 'over_budget';

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
  async check(): Promise<GuardBlock | null> {
    if (this.isPaused()) return 'paused';
    const day = startOfUtcDay(this.now());
    const spent = await this.repo.spendSince(day);
    // A budget of 0 means no cap (the subscription's limits stop first).
    if (this.config.dailyBudgetUsd === 0) return null;
    if (spent < this.config.dailyBudgetUsd) return null;
    if (this.budgetWarnedDay !== day.getTime()) {
      this.budgetWarnedDay = day.getTime();
      this.logger.warn(
        `Daily budget reached (${spent.toFixed(2)} of ${this.config.dailyBudgetUsd} USD); not processing until the next UTC day`,
      );
    }
    return 'over_budget';
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
   * the new pause. Logs only when the end moves later (`warn` for limits,
   * `error` for auth and startup).
   */
  pauseUntil(until: Date, reason: PauseReason, detail: string): void {
    const current = this.pauseState();
    if (current && until.getTime() <= current.until.getTime()) return;
    this.paused = { until, reason, detail };
    const line = `Processing paused until ${until.toISOString()} (${reason}): ${detail}`;
    if (reason === 'auth' || reason === 'startup') this.logger.error(line);
    else this.logger.warn(line);
  }

  /** A usage limit was hit: pause until its reset, or 15 minutes when unknown. */
  pauseForUsageLimit(resetsAt: Date | null, detail: string): void {
    this.pauseUntil(
      resetsAt ?? new Date(this.now().getTime() + USAGE_LIMIT_FALLBACK_MS),
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
    for (const o of observations) {
      if (o.kind !== 'weekly' && o.kind !== 'weekly_sonnet') continue;
      if (o.utilization === null) continue;
      this.weeklyUtilization = Math.max(
        this.weeklyUtilization ?? 0,
        o.utilization,
      );
      if (o.utilization < this.config.weeklyStopAt || !o.resetsAt) continue;
      const pct = Math.round(o.utilization * 100);
      this.pauseUntil(
        o.resetsAt,
        'weekly_reserve',
        `the ${o.kind === 'weekly' ? 'weekly' : 'weekly Sonnet'} limit is at ${pct}% (reserve stops at ${Math.round(this.config.weeklyStopAt * 100)}%)`,
      );
    }
  }

  /**
   * Called when the provider refused the credential (auth failure): pauses
   * for ten minutes.
   */
  pause(reason: string): void {
    this.pauseUntil(
      new Date(this.now().getTime() + PROVIDER_PAUSE_MS),
      'auth',
      `Claude refused the credential (${reason}). Run \`claude setup-token\`, update the server .env, and restart the worker.`,
    );
  }

  /** Today's logged spend, for the status endpoint. */
  async spentToday(): Promise<number> {
    return this.repo.spendSince(startOfUtcDay(this.now()));
  }
}
