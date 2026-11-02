import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  PROCESS_QUEUE,
  ProcessQueue,
  processProcessJob,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import {
  PROCESSOR_CONFIG,
  ProcessJobService,
  type ProcessorConfig,
  ProcessorRepository,
} from 'src/modules/processor';
import { assertStructuredOutputs } from 'src/modules/processor/models/openrouter.client';
import { WorkerRuntimeService } from './runtime.service';
import { syncProcessSweepScheduler } from './scheduler';

@Injectable()
export class ProcessorWorkerService {
  private readonly logger = new Logger(ProcessorWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: ProcessJobService,
    private readonly repo: ProcessorRepository,
    private readonly processQueue: ProcessQueue,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  async start(connection: Redis): Promise<void> {
    // Fail at startup, not per job, when the model cannot do structured output.
    await assertStructuredOutputs(this.config.extractionModel);
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
