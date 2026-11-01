import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import { JobsService } from 'src/infrastructure/jobs/jobs.service';
import { CacheService } from 'src/infrastructure/redis/cache.service';
import {
  CheckStatus,
  HealthStatus,
  type HealthCheckDto,
  type HealthResponseDto,
} from '../dto/health.response.dto';

/** A probe that hangs counts as down; orchestrators time out around 5s. */
export const HEALTH_CHECK_TIMEOUT_MS = 2000;

type CheckName = keyof HealthResponseDto['checks'];

/**
 * @description Probes every dependency the engine needs, in parallel.
 * `database` and `queue` are critical: without them requests or jobs fail.
 * `cache` is not: CacheService already treats an outage as a miss, so a
 * cache outage only degrades the service.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly critical: readonly CheckName[] = ['database', 'queue'];

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly cache: CacheService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [database, queue, cache] = await Promise.all([
      this.probe('database', () => this.database.ping()),
      this.probe('queue', () => this.jobs.ping()),
      this.probe('cache', () => this.cache.ping()),
    ]);
    const checks = { database, queue, cache };
    const down = (Object.keys(checks) as CheckName[]).filter(
      (name) => checks[name].status === CheckStatus.down,
    );
    const status = down.some((name) => this.critical.includes(name))
      ? HealthStatus.error
      : down.length > 0
        ? HealthStatus.degraded
        : HealthStatus.ok;
    return { status, checks };
  }

  private async probe(
    name: CheckName,
    run: () => Promise<unknown>,
  ): Promise<HealthCheckDto> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
            HEALTH_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: CheckStatus.up, latencyMs: elapsed(started) };
    } catch (error) {
      // Logged, not returned: the endpoint is public and must not leak internals.
      this.logger.warn(
        `Health check "${name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: CheckStatus.down, latencyMs: elapsed(started) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
