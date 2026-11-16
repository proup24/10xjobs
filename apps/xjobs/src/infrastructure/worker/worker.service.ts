import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { Channel } from 'src/common/enums';
import type { WorkerProcessEnvironmentVariables } from 'src/config';
import {
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from 'src/modules/processor';
import { CollectionWorkerService } from './collection.service';
import { InfrastructureWorkerService } from './infrastructure.service';
import { IngestWorkerService } from './ingest.service';
import { MatchWorkerService } from './match.service';
import { ProcessorWorkerService } from './processor.service';
import { WebhookWorkerService } from './webhook.service';
import { WorkerRuntimeService } from './runtime.service';

/** Selects the worker for this process and coordinates its lifecycle. */
@Injectable()
export class WorkerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly channel?: Channel;
  private readonly role?: 'ingest' | 'processor' | 'match' | 'webhook' | 'all';
  /** In `all`, the processor runs whenever a Claude credential is set. */
  private readonly hasCredential: boolean;
  /** False once the channel turned out to be disabled; the process should exit. */
  active = true;

  constructor(
    config: ConfigService<WorkerProcessEnvironmentVariables, true>,
    private readonly runtime: WorkerRuntimeService,
    private readonly collection: CollectionWorkerService,
    private readonly ingest: IngestWorkerService,
    private readonly processor: ProcessorWorkerService,
    private readonly match: MatchWorkerService,
    private readonly webhook: WebhookWorkerService,
    private readonly infrastructure: InfrastructureWorkerService,
  ) {
    this.role = config.get('WORKER_ROLE', { infer: true });
    this.channel = config.get('WORKER_CHANNEL', { infer: true });
    this.hasCredential = hasClaudeCredential({
      CLAUDE_CODE_OAUTH_TOKEN: config.get('CLAUDE_CODE_OAUTH_TOKEN', {
        infer: true,
      }),
      ANTHROPIC_API_KEY: config.get('ANTHROPIC_API_KEY', { infer: true }),
    });
  }

  async onModuleInit(): Promise<void> {
    // Before anything else starts, so a missing or wrong `claude` leaves
    // nothing running. A failed credential check only pauses the processor;
    // under `all` the other workers do not wait for it.
    if (this.runsProcessor())
      await this.processor.checkStartup({ wait: this.role === 'processor' });
    else if (this.role === 'all')
      this.logger.warn(`processor not started: ${NO_CLAUDE_CREDENTIAL}`);

    const connection = this.runtime.connect();

    if (this.role === 'all') await this.startAll(connection);
    else if (this.role === 'ingest') await this.ingest.start(connection);
    else if (this.role === 'processor') await this.processor.start(connection);
    else if (this.role === 'match') await this.match.start(connection);
    else if (this.role === 'webhook') await this.webhook.start(connection);
    else if (this.channel)
      this.active = await this.collection.start(this.channel, connection);
    else this.infrastructure.start(connection);

    await this.runtime.waitUntilReady();
  }

  private runsProcessor(): boolean {
    return (
      this.role === 'processor' || (this.role === 'all' && this.hasCredential)
    );
  }

  /**
   * Every step in one process; a disabled channel is skipped, not fatal. The
   * processor runs when a Claude credential is set (the subscription's limits
   * and the weekly reserve bound it); the matcher and the webhook sender need none and always run.
   */
  private async startAll(connection: Redis): Promise<void> {
    this.infrastructure.start(connection);
    await this.ingest.start(connection);
    if (this.hasCredential) await this.processor.start(connection);
    await this.match.start(connection);
    await this.webhook.start(connection);
    for (const channel of Object.values(Channel))
      await this.collection.start(channel, connection);
  }

  /**
   * Drains before any module's shutdown hook closes the database or queues
   * that the jobs still in flight write to. Collection stops between segments
   * first, so the drain fits in the container's stop grace period.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.collection.stop();
    await this.runtime.close();
  }
}
