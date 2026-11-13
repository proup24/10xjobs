import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MatchQueue } from 'src/infrastructure/jobs/steps/match';
import {
  PROCESS_QUEUE,
  ProcessQueue,
  processProcessJob,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import {
  CLAUDE_BIN,
  checkClaudeCall,
  checkClaudeInstalled,
  describeFailure,
  ExtractionModel,
  PROCESSOR_CONFIG,
  ProcessorGuard,
  ProcessorService,
  type ProcessorConfig,
  ProcessorRepository,
} from 'src/modules/processor';
import { WorkerRuntimeService } from './runtime.service';
import { RUN_SCHEDULES, syncProcessSweepScheduler } from './scheduler';

/** How long a failed startup call pauses the processor before the next check. */
export const STARTUP_RECHECK_MS = 10 * 60_000;

@Injectable()
export class ProcessorWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(ProcessorWorkerService.name);
  private checked = false;
  private recheck: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly service: ProcessorService,
    private readonly repo: ProcessorRepository,
    private readonly processQueue: ProcessQueue,
    private readonly matchQueue: MatchQueue,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    private readonly guard: ProcessorGuard,
    private readonly model: ExtractionModel,
    @Inject(CLAUDE_BIN) private readonly bin: string,
    @Inject(RUN_SCHEDULES) private readonly runSchedules: boolean,
  ) {}

  /**
   * A missing `claude` or another version than the pinned one fails startup.
   * Then one tiny call checks the credential: a failure never stops the
   * worker. A usage limit pauses until its reset; any other failure pauses
   * with reason `startup` and the check re-runs every 10 minutes until it
   * passes. Runs once; `start` runs it when nobody did before.
   */
  async checkStartup(): Promise<void> {
    if (this.checked) return;
    await checkClaudeInstalled(this.bin);
    this.checked = true;
    await this.checkCall();
  }

  private async checkCall(): Promise<void> {
    this.recheck = null;
    const failure = await checkClaudeCall(this.model);
    if (this.destroyed) return;
    if (!failure) {
      this.guard.clearPause('startup');
      this.logger.log('processor ready');
      return;
    }
    if (failure.kind === 'usage_limit') {
      this.guard.pauseForUsageLimit(
        failure.limit?.resetsAt ?? null,
        `${describeFailure(failure)} at startup`,
      );
      return;
    }
    this.guard.pauseUntil(
      new Date(Date.now() + STARTUP_RECHECK_MS),
      'startup',
      `${describeFailure(failure)} Checking again in 10 minutes.`,
    );
    // Never keeps the process alive on shutdown.
    this.recheck = setTimeout(() => {
      void this.checkCall().catch((error: unknown) =>
        this.logger.error(
          `Startup recheck failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, STARTUP_RECHECK_MS);
    this.recheck.unref();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
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
