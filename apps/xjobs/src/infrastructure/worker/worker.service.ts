import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { Channel } from 'src/common/enums';
import type { WorkerProcessEnvironmentVariables } from 'src/config';
import { CollectionWorkerService } from './collection.service';
import { InfrastructureWorkerService } from './infrastructure.service';
import { IngestWorkerService } from './ingest.service';
import { ProcessorWorkerService } from './processor.service';
import { WorkerRuntimeService } from './runtime.service';

/** Selects the worker for this process and coordinates its lifecycle. */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly channel?: Channel;
  private readonly role?: 'ingest' | 'processor' | 'all';
  /** In `all`, the processor runs whenever the OpenRouter key is set. */
  private readonly hasProcessorKey: boolean;
  /** False once the channel turned out to be disabled; the process should exit. */
  active = true;

  constructor(
    config: ConfigService<WorkerProcessEnvironmentVariables, true>,
    private readonly runtime: WorkerRuntimeService,
    private readonly collection: CollectionWorkerService,
    private readonly ingest: IngestWorkerService,
    private readonly processor: ProcessorWorkerService,
    private readonly infrastructure: InfrastructureWorkerService,
  ) {
    this.role = config.get('WORKER_ROLE', { infer: true });
    this.channel = config.get('WORKER_CHANNEL', { infer: true });
    this.hasProcessorKey = Boolean(
      config.get('OPENROUTER_API_KEY', { infer: true }),
    );
  }

  async onModuleInit(): Promise<void> {
    // Before anything else starts, so a failed check leaves nothing running.
    if (this.runsProcessor()) await this.processor.checkStartup();
    else if (this.role === 'all')
      this.logger.warn(
        'processor not started: OPENROUTER_API_KEY is not set, so new jobs wait in the process queue',
      );

    const connection = this.runtime.connect();

    if (this.role === 'all') await this.startAll(connection);
    else if (this.role === 'ingest') await this.ingest.start(connection);
    else if (this.role === 'processor') await this.processor.start(connection);
    else if (this.channel)
      this.active = await this.collection.start(this.channel, connection);
    else this.infrastructure.start(connection);

    await this.runtime.waitUntilReady();
  }

  private runsProcessor(): boolean {
    return (
      this.role === 'processor' || (this.role === 'all' && this.hasProcessorKey)
    );
  }

  /**
   * Every step in one process; a disabled channel is skipped, not fatal. The
   * processor runs when the OpenRouter key is set (its daily budget caps spend).
   */
  private async startAll(connection: Redis): Promise<void> {
    this.infrastructure.start(connection);
    await this.ingest.start(connection);
    if (this.hasProcessorKey) await this.processor.start(connection);
    for (const channel of Object.values(Channel))
      await this.collection.start(channel, connection);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime.close();
  }
}
