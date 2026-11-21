import type { StoredMatch } from '../repositories/matcher.repository';
import { exampleProfile } from '../rules/fixtures.testing';
import { MemoryMatcherRepository } from './memory-matcher.repository';

const row = (jobId: string): StoredMatch =>
  ({
    profileId: 'p',
    userId: 'u',
    jobId,
    extractionId: 'e',
    factsHash: 'h',
    profileVersion: null,
    eligibilityVersion: null,
    outcome: 'qualified',
    unverified: false,
    review: null,
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

describe('MemoryMatcherRepository.listPublishedProfiles', () => {
  const stale = { jobId: 'j', factsHash: 'h', extractionId: 'e' };

  it('lists a profile whose row is on an older matchVersion, not one on the current version or a null one', async () => {
    const repo = new MemoryMatcherRepository();
    const p = { ...exampleProfile(), id: 'p', matchVersion: 3 };
    repo.profiles = [p];
    const decided = (profileVersion: number | null) => ({
      ...row('j'),
      profileId: 'p',
      matcherVersion: Number.MAX_SAFE_INTEGER,
      profileVersion,
    });
    const ids = async () =>
      (await repo.listPublishedProfiles({ onlyStaleFor: stale })).map(
        (x) => x.id,
      );
    await repo.upsertMatches([decided(3)]);
    expect(await ids()).toEqual([]);
    p.matchVersion = 4;
    expect(await ids()).toEqual(['p']);
    await repo.upsertMatches([decided(null)]);
    expect(await ids()).toEqual(['p']);
  });
});
