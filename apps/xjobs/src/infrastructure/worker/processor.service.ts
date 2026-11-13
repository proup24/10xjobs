import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MatchQueue } from 'src/infrastructure/jobs/steps/match';
import {
  PROCESS_QUEUE,
  ProcessQueue,
  processProcessJob,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import {
  ModelPricing,
  PROCESSOR_CONFIG,
  ProcessorService,
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
import { RUN_SCHEDULES, syncProcessSweepScheduler } from './scheduler';

@Injectable()
export class ProcessorWorkerService {
  private readonly logger = new Logger(ProcessorWorkerService.name);
  private checked = false;

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: ProcessorService,
    private readonly repo: ProcessorRepository,
    private readonly processQueue: ProcessQueue,
    private readonly matchQueue: MatchQueue,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    private readonly pricing: ModelPricing,
    @Inject(OPENROUTER_CLIENT) private readonly client: OpenRouterClient,
    @Inject(RUN_SCHEDULES) private readonly runSchedules: boolean,
  ) {}

  /**
   * Fails startup, not every job, when the key is rejected, or the extraction
   * model is not listed, not priced, or cannot do structured output.
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
    await syncProcessSweepScheduler(queue, this.runSchedules);
    this.runtime.startWorker(
      PROCESS_QUEUE,
      (bullJob) =>
        processProcessJob(bullJob, {
          service: this.service,
          repo: this.repo,
          queue: this.processQueue,
          matchQueue: this.matchQueue,
          config: this.config,
        }),
      this.config.concurrency,
      connection,
    );
    this.logger.log(
      this.runSchedules
        ? `Processing jobs; sweeping every ${processSweepConfig.everyMs / 1000}s`
        : 'Processing jobs; schedules off',
    );
  }
}
