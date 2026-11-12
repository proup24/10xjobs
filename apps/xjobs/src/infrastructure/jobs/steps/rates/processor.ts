import { UnrecoverableError } from 'bullmq';
import type { RatesService } from 'src/modules/rates';
import { RATES_REFRESH_JOB } from './queue.service';

export interface RatesJobDeps {
  service: Pick<RatesService, 'refresh'>;
}

/** Runs one job of the `rates` queue: the daily refresh. */
export async function processRatesJob(
  job: { name: string; data: unknown },
  deps: RatesJobDeps,
): Promise<{ updated: number }> {
  if (job.name === RATES_REFRESH_JOB) return deps.service.refresh();
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}
