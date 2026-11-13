import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { ProcessorEnvironmentVariables } from 'src/config';
import { DatabaseModule } from 'src/database';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from './config/processor.config';
import { AiSdkExtractionModel } from './models/extraction.model';
import {
  createOpenRouterClient,
  OPENROUTER_CLIENT,
  type OpenRouterClient,
} from './models/client';
import { ModelPricing } from './models/pricing';
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
    ModelPricing,
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
        generationTries: config.get('PROCESSOR_GENERATION_TRIES', {
          infer: true,
        }),
      }),
    },
    {
      provide: OPENROUTER_CLIENT,
      inject: [ConfigService],
      // The key is required only when the processor runs (startup validation).
      useFactory: (config: Env): OpenRouterClient =>
        createOpenRouterClient(
          config.get('OPENROUTER_API_KEY', { infer: true }) ?? '',
        ),
    },
    {
      provide: ExtractionModel,
      inject: [ConfigService, PROCESSOR_CONFIG, ModelPricing],
      // The generator goes through the AI SDK; the startup checks stay on
      // the OpenRouter SDK client.
      useFactory: (env: Env, config: ProcessorConfig, pricing: ModelPricing) =>
        new AiSdkExtractionModel(
          env.get('OPENROUTER_API_KEY', { infer: true }) ?? '',
          config.extractionModel,
          pricing,
        ),
    },
  ],
  exports: [
    OPENROUTER_CLIENT,
    ProcessorService,
    ProcessorRepository,
    PROCESSOR_CONFIG,
    ModelPricing,
  ],
})
export class ProcessorModule {}
