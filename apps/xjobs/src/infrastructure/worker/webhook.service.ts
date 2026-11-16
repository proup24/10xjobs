import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  WEBHOOK_QUEUE,
  WEBHOOK_SWEEP_JOB,
  WebhookQueue,
  processWebhookJob,
} from 'src/infrastructure/jobs/steps/webhook';
import {
  DeliveryService,
  WEBHOOK_CONFIG,
  WebhooksRepository,
} from 'src/modules/webhooks';
import { WorkerRuntimeService } from './runtime.service';
import { RUN_SCHEDULES, syncWebhookSweepScheduler } from './scheduler';

const WEBHOOK_CONCURRENCY = 4;

@Injectable()
export class WebhookWorkerService {
  private readonly logger = new Logger(WebhookWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: DeliveryService,
    private readonly repo: WebhooksRepository,
    private readonly webhookQueue: WebhookQueue,
    @Inject(RUN_SCHEDULES) private readonly runSchedules: boolean,
  ) {}

  async start(connection: Redis): Promise<void> {
    const queue = await this.runtime.createQueue(WEBHOOK_QUEUE, connection);
    await syncWebhookSweepScheduler(queue, this.runSchedules);
    this.runtime.startWorker(
      WEBHOOK_QUEUE,
      async (bullJob) => {
        const result = await processWebhookJob(bullJob, {
          service: this.service,
          repo: this.repo,
          queue: this.webhookQueue,
        });
        if (bullJob.name === WEBHOOK_SWEEP_JOB)
          this.logger.log(`Webhook sweep: ${JSON.stringify(result)}`);
        return result;
      },
      WEBHOOK_CONCURRENCY,
      connection,
    );
    this.logger.log(
      this.runSchedules
        ? `Sending webhooks; sweeping every ${WEBHOOK_CONFIG.sweep.everyMs / 1000}s`
        : 'Sending webhooks; schedules off',
    );
  }
}
