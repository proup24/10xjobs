import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  PROCESS_QUEUE,
  ProcessQueue,
  processProcessJob,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import {
  ModelPricing,
  PROCESSOR_CONFIG,
  ProcessJobService,
  type ProcessorConfig,
  ProcessorRepository,
} from 'src/modules/processor';
import {
  assertApiKey,
  checkModels,
  OPENROUTER_CLIENT,
  type OpenRouterClient,
} from 'src/modules/processor/models/client';
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
    @Inject(OPENROUTER_CLIENT) private readonly client: OpenRouterClient,
  ) {}

  /**
   * Fails startup, not every job, when the key is rejected, or the extraction
   * model is not listed, not priced, or cannot do structured output. The
   * decision model is priced only when OpenRouter lists it (see checkModels).
   * Runs once; `start` runs it when nobody did before.
   */
  async checkStartup(): Promise<void> {
    if (this.checked) return;
    await assertApiKey(this.client);
    this.pricing.set(await checkModels(this.client, this.config));
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
