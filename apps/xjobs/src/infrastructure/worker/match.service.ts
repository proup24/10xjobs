import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  MATCH_QUEUE,
  MATCH_SWEEP,
  MatchQueue,
  processMatchJob,
} from 'src/infrastructure/jobs/steps/match';
import {
  RATES_QUEUE,
  RATES_REFRESH_JOB,
  RATES_REFRESH_ON_START_JOB_ID,
  processRatesJob,
} from 'src/infrastructure/jobs/steps/rates';
import { MatcherRepository, MatcherService } from 'src/modules/matcher';
import { RatesService } from 'src/modules/rates';
import { WorkerRuntimeService } from './runtime.service';
import {
  RUN_SCHEDULES,
  syncMatchSweepScheduler,
  syncRatesRefreshScheduler,
} from './scheduler';

const MATCH_CONCURRENCY = 4;

@Injectable()
export class MatchWorkerService {
  private readonly logger = new Logger(MatchWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: MatcherService,
    private readonly repo: MatcherRepository,
    private readonly matchQueue: MatchQueue,
    private readonly rates: RatesService,
    @Inject(RUN_SCHEDULES) private readonly runSchedules: boolean,
  ) {}

  async start(connection: Redis): Promise<void> {
    if (this.runSchedules) await this.ensureRates();
    const queue = await this.runtime.createQueue(MATCH_QUEUE, connection);
    await syncMatchSweepScheduler(queue, this.runSchedules);
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
    // The rates refresh rides in the match worker: matching converts salaries with these rates.
    const ratesQueue = await this.runtime.createQueue(RATES_QUEUE, connection);
    await syncRatesRefreshScheduler(ratesQueue, this.runSchedules);
    if (this.runSchedules) {
      // Refresh at every start so a fresh or stale table does not wait for 03:00 UTC.
      // The fixed id keeps restarts from stacking; the finished job is removed so the
      // next boot can add it again.
      await ratesQueue.add(
        RATES_REFRESH_JOB,
        {},
        {
          jobId: RATES_REFRESH_ON_START_JOB_ID,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
    this.runtime.startWorker(
      RATES_QUEUE,
      async (bullJob) => {
        const result = await processRatesJob(bullJob, {
          service: this.rates,
        });
        this.logger.log(`Rates refresh: ${JSON.stringify(result)}`);
        return result;
      },
      1,
      connection,
    );
    this.logger.log(
      this.runSchedules
        ? `Matching jobs; sweeping every ${MATCH_SWEEP.everyMs / 1000}s`
        : 'Matching jobs; schedules off',
    );
  }

  /**
   * On a fresh rates table, fetches the rates once before matching starts, so a deploy's
   * re-decide does not convert salaries without them. A failure is logged, never fatal.
   */
  private async ensureRates(): Promise<void> {
    try {
      if (await this.rates.hasRates()) return;
      const { updated } = await this.rates.refresh();
      this.logger.log(`Rates table was empty; refreshed ${updated} rates`);
    } catch (error) {
      this.logger.warn(
        `Rates check before matching failed, matching starts anyway: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
