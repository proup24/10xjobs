/**
 * Pure helpers of the paid path in `indeed-sample.ts`, kept here so they are
 * testable without Apify: the start options, the best-effort item listing and
 * how the sample ends once the runs are done.
 */
import type { PlannedRun } from './plan';

/** Every start: Apify's charge cap is the run's reservation; memory and timeout are pinned. */
export function startOptions(run: PlannedRun): {
  maxTotalChargeUsd: number;
  memory: number;
  timeout: number;
} {
  return {
    maxTotalChargeUsd: run.reservedUsd,
    memory: run.memoryMbytes,
    timeout: run.timeoutSecs,
  };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A run's items. A run that succeeded must list them (a throw stops the
 * sample, after the spend is saved); for any other status they are kept for
 * inspection only, so a listing failure is recorded instead of thrown.
 */
export async function runItems(
  status: string,
  list: () => Promise<Record<string, unknown>[]>,
): Promise<{ items: Record<string, unknown>[]; itemsError?: string }> {
  if (status === 'SUCCEEDED') return { items: await list() };
  try {
    return { items: await list() };
  } catch (error) {
    return { items: [], itemsError: message(error) };
  }
}

const describe = (label: string, error: unknown) =>
  `${label}: ${message(error)}${error instanceof Error && error.stack ? `\n${error.stack}` : ''}`;

/**
 * After the paid loop: logs a paid failure first (so a report failure can't
 * mask it), builds the report anyway, then rethrows the paid failure, else a
 * report failure. A run that stopped without a throw still exits non-zero.
 */
export async function finishSample(opts: {
  failure: unknown;
  stopped: boolean;
  report: () => Promise<void>;
  log: (line: string) => void;
}): Promise<{ exitCode: 0 | 1 }> {
  const { failure, stopped, report, log } = opts;
  if (failure !== null) log(describe('Sample stopped by an error', failure));
  try {
    await report();
  } catch (reportError) {
    if (failure === null) throw reportError;
    log(describe('The report failed too', reportError));
  }
  if (failure !== null) throw failure;
  return { exitCode: stopped ? 1 : 0 };
}
