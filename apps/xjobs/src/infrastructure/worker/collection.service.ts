import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import { Channel } from 'src/common/enums';
import {
  COLLECT_JOB,
  CollectionService,
  channelJobsConfig,
} from 'src/infrastructure/jobs/steps/collect';
import { ingestConfig } from 'src/modules/ingest';
import { StorageService } from 'src/modules/storage';
import { RUN_SCHEDULES, syncCollectionScheduler } from './scheduler';
import { WorkerRuntimeService } from './runtime.service';

@Injectable()
export class CollectionWorkerService {
  private readonly logger = new Logger(CollectionWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly collection: CollectionService,
    private readonly storage: StorageService,
    @Inject(RUN_SCHEDULES) private readonly runSchedules: boolean,
  ) {}

  /** Lets a running collect job finish its current segment and start no other. */
  stop(): void {
    this.collection.stop();
  }

  /** Returns false when the channel is disabled. With schedules off it still starts the worker. */
  async start(channel: Channel, connection: Redis): Promise<boolean> {
    await this.storage.ensureBucket(ingestConfig.bucket);
    const config = channelJobsConfig[channel];
    const queue = await this.runtime.createQueue(config.queueName, connection);
    await syncCollectionScheduler(queue, config, this.runSchedules);
    if (!config.enabled) {
      this.logger.log(`${channel} disabled; scheduler removed`);
      return false;
    }
    this.runtime.startWorker(
      config.queueName,
      async (bullJob) => {
        if (bullJob.name !== COLLECT_JOB)
          throw new UnrecoverableError(`Unsupported job: ${bullJob.name}`);
        return this.collection.collect(channel);
      },
      config.concurrency,
      connection,
    );
    if (!this.runSchedules)
      this.logger.log(
        `${channel}: schedules off (XJOBS_RUN_SCHEDULES not set); scheduler removed`,
      );
    else
      this.logger.log(
        `Collecting ${channel} on ${config.schedule.pattern} ${config.schedule.timezone}`,
      );
    return true;
  }
}
