import { MemoryProcessorRepository } from './fakes';

describe('MemoryProcessorRepository finish', () => {
  it('gives the attempt back on a refunded pending finish', async () => {
    const repo = new MemoryProcessorRepository();
    repo.addJob({ id: 'j1', processingAttempts: 1 });
    const claim = (await repo.claim('j1'))!;
    expect(claim.attempts).toBe(2);
    expect(
      await repo.finish(claim, {
        status: 'pending',
        error: '401',
        refundAttempt: true,
      }),
    ).toBe('finished');
    expect(repo.jobs.get('j1')).toMatchObject({
      processingStatus: 'pending',
      processingAttempts: 1,
      processingError: '401',
    });
  });

  it('keeps the attempt on an ordinary retry', async () => {
    const repo = new MemoryProcessorRepository();
    repo.addJob({ id: 'j1' });
    const claim = (await repo.claim('j1'))!;
    await repo.finish(claim, { status: 'pending', error: '429' });
    expect(repo.jobs.get('j1')?.processingAttempts).toBe(1);
  });
});
