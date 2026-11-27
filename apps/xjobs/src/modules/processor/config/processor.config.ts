import { Channel, TRIAL_CHANNELS } from 'src/common/enums';

/**
 * The channels whose jobs this version processes (spec §1). A job is in scope
 * when one of its sources comes from one of them: the LinkedIn job board
 * (harvestapi and the trial channels) and Indeed.
 */
export const PROCESSOR_CHANNELS: readonly Channel[] = [
  Channel.LINKEDIN_JOB_BOARD,
  ...TRIAL_CHANNELS,
  Channel.INDEED,
];

export interface ProcessorConfig {
  extractionModel: string;
  concurrency: number;
  maxAttempts: number;
  claimTimeoutMs: number;
  /** 0 means no cap. */
  dailyBudgetUsd: number;
  /** Weekly utilization (0 to 1) at which processing stops until the reset. */
  weeklyStopAt: number;
  /** Model calls per generation: the first and its schema-fix retries (spec §2). */
  generationTries: number;
  /** Post model calls per UTC day; 0 pauses post extraction. */
  postDailyCap: number;
}

export const PROCESSOR_CONFIG = Symbol('PROCESSOR_CONFIG');
