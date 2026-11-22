import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { ProcessorEnvironmentVariables } from 'src/config';
import { DatabaseModule } from 'src/database';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from './config/processor.config';
import { createClaudeExtractionModel } from './models/claude-extraction.model';
import { CLAUDE_BIN, claudeBin } from './models/claude/startup';
import { ExtractionModel } from './models/types';
import {
  PrismaProcessorRepository,
  ProcessorRepository,
} from './repositories/processor.repository';
import {
  PrismaVocabRepository,
  VocabRepository,
} from './repositories/vocab.repository';
import { ExtractionPipeline } from './services/extraction-pipeline.service';
import { ExtractionStore } from './services/extraction-store.service';
import { FactAssembler } from './services/fact-assembler.service';
import { GenerationService } from './services/generation.service';
import { ProcessorGuard } from './services/processor-guard.service';
import { ProcessorService } from './services/processor.service';

type Env = ConfigService<ProcessorEnvironmentVariables, true>;

/**
 * Turns normalized jobs into validated extractions (spec: processor design).
 * `ProcessorService` is the entry point; the worker and the operator
 * controller (`OperatorModule`, local only) both call it.
 */
@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    ProcessorService,
    ProcessorGuard,
    ExtractionPipeline,
    GenerationService,
    FactAssembler,
    ExtractionStore,
    { provide: ProcessorRepository, useClass: PrismaProcessorRepository },
    { provide: VocabRepository, useClass: PrismaVocabRepository },
    {
      provide: PROCESSOR_CONFIG,
      inject: [ConfigService],
      useFactory: (config: Env): ProcessorConfig => ({
        extractionModel: config.get('PROCESSOR_EXTRACTION_MODEL', {
          infer: true,
        }),
        concurrency: config.get('PROCESSOR_CONCURRENCY', { infer: true }),
        maxAttempts: config.get('PROCESSOR_MAX_ATTEMPTS', { infer: true }),
        claimTimeoutMs: config.get('PROCESSOR_CLAIM_TIMEOUT_MS', {
          infer: true,
        }),
        dailyBudgetUsd: config.get('PROCESSOR_DAILY_BUDGET_USD', {
          infer: true,
        }),
        weeklyStopAt: config.get('PROCESSOR_WEEKLY_STOP_AT', { infer: true }),
        postDailyCap: config.get('POST_EXTRACTION_DAILY_CAP', { infer: true }),
        generationTries: config.get('PROCESSOR_GENERATION_TRIES', {
          infer: true,
        }),
      }),
    },
    {
      provide: CLAUDE_BIN,
      // The fake binary only under NODE_ENV=test; `claude` from PATH otherwise.
      useFactory: (): string => claudeBin(process.env),
    },
    {
      provide: ExtractionModel,
      inject: [ConfigService, PROCESSOR_CONFIG, CLAUDE_BIN, ProcessorGuard],
      // The credential is required only when the processor runs (startup
      // validation); the runner reads it from the process environment.
      useFactory: (
        env: Env,
        config: ProcessorConfig,
        bin: string,
        guard: ProcessorGuard,
      ) =>
        createClaudeExtractionModel({
          model: config.extractionModel,
          effort: env.get('PROCESSOR_EFFORT', { infer: true }),
          timeoutMs: env.get('PROCESSOR_CALL_TIMEOUT_MS', { infer: true }),
          bin,
          onLimits: (observations) => guard.observeLimits(observations),
        }),
    },
  ],
  exports: [
    ProcessorService,
    ProcessorGuard,
    ProcessorRepository,
    PROCESSOR_CONFIG,
    ExtractionModel,
    CLAUDE_BIN,
  ],
})
export class ProcessorModule {}
