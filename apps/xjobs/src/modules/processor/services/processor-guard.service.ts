import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { ProcessorRepository } from '../repositories/processor.repository';

/** How long processing stops after a key, credit or account error. */
export const PROVIDER_PAUSE_MS = 10 * 60_000;

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
  private pausedUntil = 0;
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
    return this.now().getTime() < this.pausedUntil;
  }

  /** Called when the provider refused the key, credit or account. */
  pause(reason: string): void {
    if (!this.isPaused())
      this.logger.error(
        `OpenRouter refused the request (${reason}); pausing processing for ${PROVIDER_PAUSE_MS / 60_000} minutes. Check the key and the account's credit.`,
      );
    this.pausedUntil = this.now().getTime() + PROVIDER_PAUSE_MS;
  }

  /** Today's logged spend, for the status endpoint. */
  async spentToday(): Promise<number> {
    return this.repo.spendSince(startOfUtcDay(this.now()));
  }
}
