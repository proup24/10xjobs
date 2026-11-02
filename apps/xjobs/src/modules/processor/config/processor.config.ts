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
}

export const PROCESSOR_CONFIG = Symbol('PROCESSOR_CONFIG');
