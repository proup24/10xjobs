import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  PROCESS_QUEUE,
  ProcessQueue,
  processProcessJob,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import type { WorkerProcessEnvironmentVariables } from 'src/config';
import {
  ModelPricing,
  PROCESSOR_CONFIG,
  ProcessJobService,
  type ProcessorConfig,
  ProcessorRepository,
} from 'src/modules/processor';
import {
  assertApiKey,
  assertStructuredOutputs,
  loadModelPricing,
} from 'src/modules/processor/models/openrouter.client';
import { WorkerRuntimeService } from './runtime.service';
import { syncProcessSweepScheduler } from './scheduler';

@Injectable()
export class ProcessorWorkerService {
  private readonly logger = new Logger(ProcessorWorkerService.name);
  private checked = false;

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: ProcessJobService,
    private readonly repo: ProcessorRepository,
    private readonly processQueue: ProcessQueue,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    private readonly pricing: ModelPricing,
    private readonly env: ConfigService<
      WorkerProcessEnvironmentVariables,
      true
    >,
  ) {}

  /**
   * Fails startup, not every job, when the key is rejected, a model is not
   * listed or priced, or the extraction model cannot do structured output.
   * Runs once; `start` runs it when nobody did before.
   */
  async checkStartup(): Promise<void> {
    if (this.checked) return;
    await assertApiKey(
      this.env.get('OPENROUTER_API_KEY', { infer: true }) ?? '',
    );
    await assertStructuredOutputs(this.config.extractionModel);
    this.pricing.set(
      await loadModelPricing([
        this.config.decisionModel,
        this.config.extractionModel,
      ]),
    );
    this.checked = true;
  }

  async start(connection: Redis): Promise<void> {
    await this.checkStartup();
    const queue = await this.runtime.createQueue(PROCESS_QUEUE, connection);
    await syncProcessSweepScheduler(queue);
    this.runtime.startWorker(
      PROCESS_QUEUE,
      (bullJob) =>
        processProcessJob(bullJob, {
          service: this.service,
          repo: this.repo,
          queue: this.processQueue,
          config: this.config,
        }),
      this.config.concurrency,
      connection,
    );
    this.logger.log(
      `Processing jobs; sweeping every ${processSweepConfig.everyMs / 1000}s`,
    );
  }
}
