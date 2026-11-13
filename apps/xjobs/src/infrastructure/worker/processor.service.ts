import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { ProcessorEnvironmentVariables } from 'src/config';
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

/** How often a failed startup check runs again. */
export const STARTUP_RECHECK_MS = 10 * 60_000;

/** Slack past the call timeout, for spawning and cleanup. */
const CHECK_MARGIN_MS = 30_000;

@Injectable()
export class ProcessorWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(ProcessorWorkerService.name);
  private checked = false;
  private recheck: NodeJS.Timeout | null = null;
  private destroyed = false;
  private background: Promise<void> | null = null;
  private readonly callTimeoutMs: number;

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
    env: ConfigService<ProcessorEnvironmentVariables, true>,
  ) {
    this.callTimeoutMs = env.get('PROCESSOR_CALL_TIMEOUT_MS', {
      infer: true,
    });
  }

  /**
   * A missing `claude` or another version than the pinned one fails startup.
   * Then one tiny call checks the credential; a failure never stops the
   * worker. A usage limit pauses until its reset; any other failure pauses
   * with reason `startup` and the check re-runs every 10 minutes until it
   * passes. The processor stays paused while a check runs, so it never claims
   * with an untested or known-bad credential.
   *
   * `wait: false` (worker-all) returns once the binary is checked and leaves
   * the call running, so the other workers start as usual. Runs once; `start`
   * runs it, waiting, when nobody did before.
   */
  async checkStartup(opts: { wait: boolean } = { wait: true }): Promise<void> {
    if (this.checked) return;
    await checkClaudeInstalled(this.bin);
    this.checked = true;
    const check = this.checkCall();
    if (opts.wait) await check;
    else this.background = check;
  }

  /** The startup check left running by `checkStartup({ wait: false })`, for tests. */
  get pendingCheck(): Promise<void> | null {
    return this.background;
  }

  private async checkCall(): Promise<void> {
    this.recheck = null;
    // Covers the call itself: a pause ending mid-call would let jobs claim.
    // The first check logs at info; a recheck keeps the failure's detail.
    const current = this.guard.pauseState();
    const failing = current?.reason === 'startup';
    this.guard.pauseUntil(
      new Date(Date.now() + this.callTimeoutMs + CHECK_MARGIN_MS),
      'startup',
      failing ? current.detail : 'checking the Claude credential',
      failing ? undefined : 'log',
    );
    let failure: Awaited<ReturnType<typeof checkClaudeCall>>;
    try {
      failure = await checkClaudeCall(this.model);
    } catch (error) {
      failure = {
        kind: 'transient',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (this.destroyed) return;
    if (!failure) {
      this.guard.clearPause('startup');
      this.logger.log('processor ready');
      return;
    }
    if (failure.kind === 'usage_limit') {
      this.guard.clearPause('startup');
      this.guard.pauseForUsageLimit(
        failure.limit?.resetsAt ?? null,
        `${describeFailure(failure)} at startup`,
      );
      return;
    }
    // Lasts past the next check's start; that check extends it again.
    this.guard.pauseUntil(
      new Date(Date.now() + STARTUP_RECHECK_MS + this.callTimeoutMs),
      'startup',
      `${describeFailure(failure)} Checking again in 10 minutes.`,
    );
    // Never keeps the process alive on shutdown.
    this.recheck = setTimeout(() => {
      void this.checkCall();
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
