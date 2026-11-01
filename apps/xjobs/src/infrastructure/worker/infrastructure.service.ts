import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RedisConfig } from 'src/config';
import { INFRASTRUCTURE_QUEUE } from 'src/infrastructure/jobs/jobs.service';
import { processInfrastructureJob } from 'src/infrastructure/jobs/processor';
import { REDIS_SETTINGS } from 'src/infrastructure/redis/settings.module';
import { WorkerRuntimeService } from './runtime.service';

@Injectable()
export class InfrastructureWorkerService {
  constructor(
    @Inject(REDIS_SETTINGS) private readonly settings: RedisConfig,
    private readonly runtime: WorkerRuntimeService,
  ) {}

  start(connection: Redis): void {
    this.runtime.startWorker(
      INFRASTRUCTURE_QUEUE,
      processInfrastructureJob,
      this.settings.jobsConcurrency,
      connection,
    );
  }
}
