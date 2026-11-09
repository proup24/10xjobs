import type { StoredMatch } from '../repositories/matcher.repository';
import { MemoryMatcherRepository } from './memory-matcher.repository';

const row = (jobId: string): StoredMatch =>
  ({
    profileId: 'p',
    userId: 'u',
    jobId,
    extractionId: 'e',
    outcome: 'qualified',
    unverified: false,
    stackScore: null,
    checks: [],
  }) as StoredMatch;

describe('MemoryMatcherRepository.deleteInactive', () => {
  it('deletes only rows of jobs marked inactive', async () => {
    const repo = new MemoryMatcherRepository();
    await repo.upsertMatches([row('merged'), row('active'), row('unknown')]);
    repo.inactiveJobs.add('merged');
    expect(await repo.deleteInactive()).toBe(1);
    expect((await repo.matchesForJob('merged')).length).toBe(0);
    expect((await repo.matchesForJob('active')).length).toBe(1);
    expect((await repo.matchesForJob('unknown')).length).toBe(1);
  });
});
