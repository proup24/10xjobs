import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  MATCH_QUEUE,
  MATCH_SWEEP,
  MatchQueue,
  processMatchJob,
} from 'src/infrastructure/jobs/steps/match';
import { MatcherRepository, MatcherService } from 'src/modules/matcher';
import { WorkerRuntimeService } from './runtime.service';
import { syncMatchSweepScheduler } from './scheduler';

const MATCH_CONCURRENCY = 4;

@Injectable()
export class MatchWorkerService {
  private readonly logger = new Logger(MatchWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: MatcherService,
    private readonly repo: MatcherRepository,
    private readonly matchQueue: MatchQueue,
  ) {}

  async start(connection: Redis): Promise<void> {
    const queue = await this.runtime.createQueue(MATCH_QUEUE, connection);
    await syncMatchSweepScheduler(queue);
    this.runtime.startWorker(
      MATCH_QUEUE,
      async (bullJob) => {
        const result = await processMatchJob(bullJob, {
          service: this.service,
          repo: this.repo,
          queue: this.matchQueue,
        });
        if (bullJob.name === 'sweep')
          this.logger.log(`Match sweep: ${JSON.stringify(result)}`);
        return result;
      },
      MATCH_CONCURRENCY,
      connection,
    );
    this.logger.log(
      `Matching jobs; sweeping every ${MATCH_SWEEP.everyMs / 1000}s`,
    );
  }
}
