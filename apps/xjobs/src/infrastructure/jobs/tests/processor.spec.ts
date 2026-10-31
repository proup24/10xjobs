import { processInfrastructureJob } from '../processor';

describe('infrastructure processor', () => {
  it('returns a correlation token for the smoke job', async () => {
    expect(
      await processInfrastructureJob({
        name: 'ping',
        data: { token: 'check-1' },
      }),
    ).toEqual({ token: 'check-1', status: 'ok' });
  });

  it('rejects unknown jobs and malformed payloads', async () => {
    await expect(
      processInfrastructureJob({ name: 'unsupported', data: {} }),
    ).rejects.toThrow('Unsupported job');
    await expect(
      processInfrastructureJob({ name: 'ping', data: {} }),
    ).rejects.toThrow('Invalid ping payload');
    await expect(
      processInfrastructureJob({ name: 'ping', data: null }),
    ).rejects.toThrow('Invalid ping payload');
  });
});
