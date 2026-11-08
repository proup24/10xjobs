import { Channel } from 'src/common/enums';

/**
 * The channel whose jobs this version processes (spec §1). A job is in scope
 * when one of its sources comes from it.
 */
export const PROCESSOR_CHANNEL = Channel.LINKEDIN_JOB_BOARD;

export interface ProcessorConfig {
  decisionModel: string;
  extractionModel: string;
  concurrency: number;
  maxAttempts: number;
  claimTimeoutMs: number;
  dailyBudgetUsd: number;
  /** Rounds after the first generation, when Jev rejects a field (spec §1). */
  maxRegenerations: number;
  /** Model calls per generation: the first and its schema-fix retries (spec §2). */
  generationTries: number;
}

export const PROCESSOR_CONFIG = Symbol('PROCESSOR_CONFIG');
