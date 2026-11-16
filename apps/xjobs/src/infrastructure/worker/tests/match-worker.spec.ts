import { Logger } from '@nestjs/common';
import { MATCH_QUEUE } from 'src/infrastructure/jobs/steps/match';
import { MatchWorkerService } from '../match.service';

/** Records the start order: rate checks and refreshes, and each worker started. */
function setup(opts: {
  runSchedules: boolean;
  hasRates?: () => Promise<boolean>;
}) {
  const events: string[] = [];
  const queue = {
    add: vi.fn(async () => undefined),
    upsertJobScheduler: vi.fn(async () => undefined),
    removeJobScheduler: vi.fn(async () => true),
  };
  const runtime = {
    createQueue: vi.fn(async () => queue),
    startWorker: vi.fn((name: string) => {
      events.push(`start ${name}`);
    }),
  };
  const rates = {
    hasRates: vi.fn(async () => {
      events.push('hasRates');
      return (opts.hasRates ?? (async () => true))();
    }),
    refresh: vi.fn(async () => {
      events.push('refresh');
      return { updated: 3 };
    }),
  };
  const service = new MatchWorkerService(
    runtime as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    rates as never,
    opts.runSchedules,
  );
  return { service, events, rates };
}

describe('MatchWorkerService.start', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('refreshes an empty rates table before the match worker starts', async () => {
    const { service, events } = setup({
      runSchedules: true,
      hasRates: async () => false,
    });
    await service.start({} as never);
    expect(events.indexOf('refresh')).toBeGreaterThan(-1);
    expect(events.indexOf('refresh')).toBeLessThan(
      events.indexOf(`start ${MATCH_QUEUE}`),
    );
  });

  it('does not refresh when rates are stored', async () => {
    const { service, rates, events } = setup({ runSchedules: true });
    await service.start({} as never);
    expect(rates.refresh).not.toHaveBeenCalled();
    expect(events).toContain(`start ${MATCH_QUEUE}`);
  });

  it('does not touch the rates when schedules are off', async () => {
    const { service, rates } = setup({
      runSchedules: false,
      hasRates: async () => false,
    });
    await service.start({} as never);
    expect(rates.hasRates).not.toHaveBeenCalled();
    expect(rates.refresh).not.toHaveBeenCalled();
  });

  it('logs and still starts the match worker when the rates check fails', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, events } = setup({
      runSchedules: true,
      hasRates: async () => {
        throw new Error('db down');
      },
    });
    await service.start({} as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(events).toContain(`start ${MATCH_QUEUE}`);
  });
});
