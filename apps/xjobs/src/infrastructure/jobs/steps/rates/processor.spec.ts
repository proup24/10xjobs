import { UnrecoverableError } from 'bullmq';
import { processRatesJob } from './processor';

const job = (name: string) => ({ name, data: {} });

describe('processRatesJob', () => {
  it('refreshes the rates', async () => {
    const service = { refresh: vi.fn(async () => ({ updated: 3 })) };
    expect(await processRatesJob(job('refresh'), { service })).toEqual({
      updated: 3,
    });
    expect(service.refresh).toHaveBeenCalledOnce();
  });

  it('refuses an unknown job', async () => {
    const service = { refresh: vi.fn() };
    await expect(
      processRatesJob(job('other'), { service }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(service.refresh).not.toHaveBeenCalled();
  });
});
