export interface ProcessorConfig {
  decisionModel: string;
  extractionModel: string;
  concurrency: number;
  maxAttempts: number;
  claimTimeoutMs: number;
  dailyBudgetUsd: number;
}

export const PROCESSOR_CONFIG = Symbol('PROCESSOR_CONFIG');
