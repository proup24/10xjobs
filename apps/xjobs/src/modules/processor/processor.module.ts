import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { WorkerProcessEnvironmentVariables } from 'src/config';
import { DatabaseModule } from 'src/database';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from './config/processor.config';
import { OpenRouterDecisionModel } from './models/openrouter-decision.model';
import { OpenRouterExtractionModel } from './models/openrouter-extraction.model';
import {
  createOpenRouterClient,
  OPENROUTER_CLIENT,
  type OpenRouterClient,
} from './models/openrouter.client';
import { ModelPricing } from './models/pricing';
import { DecisionModel, ExtractionModel } from './models/types';
import { ProcessJobService } from './pipeline/process-job.service';
import {
  PrismaProcessorRepository,
  ProcessorRepository,
} from './repositories/processor.repository';
import {
  PrismaVocabRepository,
  VocabRepository,
} from './repositories/vocab.repository';

type Env = ConfigService<WorkerProcessEnvironmentVariables, true>;

/** Turns normalized jobs into validated extractions (spec: processor design). */
@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    ProcessJobService,
    ModelPricing,
    { provide: ProcessorRepository, useClass: PrismaProcessorRepository },
    { provide: VocabRepository, useClass: PrismaVocabRepository },
    {
      provide: PROCESSOR_CONFIG,
      inject: [ConfigService],
      useFactory: (config: Env): ProcessorConfig => ({
        decisionModel: config.get('PROCESSOR_DECISION_MODEL', { infer: true }),
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
      provide: DecisionModel,
      inject: [OPENROUTER_CLIENT, PROCESSOR_CONFIG, ModelPricing],
      useFactory: (
        client: OpenRouterClient,
        config: ProcessorConfig,
        pricing: ModelPricing,
      ) => new OpenRouterDecisionModel(client, config.decisionModel, pricing),
    },
    {
      provide: ExtractionModel,
      inject: [OPENROUTER_CLIENT, PROCESSOR_CONFIG, ModelPricing],
      useFactory: (
        client: OpenRouterClient,
        config: ProcessorConfig,
        pricing: ModelPricing,
      ) =>
        new OpenRouterExtractionModel(client, config.extractionModel, pricing),
    },
  ],
  exports: [
    OPENROUTER_CLIENT,
    ProcessJobService,
    ProcessorRepository,
    PROCESSOR_CONFIG,
    ModelPricing,
  ],
})
export class ProcessorModule {}
