import { describe, expect, it } from 'vitest';
import { MATCHER_VERSION } from '../config/matcher.config';
import { exampleProfile, jobDoc } from '../rules/fixtures.testing';
import { MemoryMatcherRepository } from '../testing/memory-matcher.repository';
import { MatcherService } from './matcher.service';

function setup() {
  const repo = new MemoryMatcherRepository();
  repo.jobs.set('job-1', {
    jobId: 'job-1',
    extractionId: 'ext-1',
    needsReview: false,
    document: jobDoc(),
  });
  repo.profiles = [
    exampleProfile(),
    { ...exampleProfile(), id: 'profile-2', userId: 'user-2' },
  ];
  let now = 1_000_000;
  const service = new MatcherService(repo, () => now);
  return { repo, service, advance: (ms: number) => (now += ms) };
}

describe('MatcherService', () => {
  it('reports not_matchable without upserting', async () => {
    const { repo, service } = setup();
    expect(await service.matchJob('missing')).toEqual({
      status: 'not_matchable',
    });
    expect(repo.upserts).toHaveLength(0);
  });

  it('decides every stale profile and stores extractionId and version', async () => {
    const { repo, service } = setup();
    const out = await service.matchJob('job-1');
    expect(out.status).toBe('matched');
    const rows = await repo.matchesForJob('job-1');
    expect(rows.map((r) => r.profileId).sort()).toEqual([
      'profile-1',
      'profile-2',
    ]);
    expect(rows.every((r) => r.extractionId === 'ext-1')).toBe(true);
    expect(repo.rows.every((r) => r.matcherVersion === MATCHER_VERSION)).toBe(
      true,
    );
  });

  it('skips current profiles unless forced', async () => {
    const { repo, service } = setup();
    await service.matchJob('job-1');
    const again = await service.matchJob('job-1');
    expect(again).toEqual({ status: 'matched', profiles: 0, qualified: 0 });
    const forced = await service.matchJob('job-1', { force: true });
    expect(forced).toMatchObject({ status: 'matched', profiles: 2 });
    expect(repo.upserts).toHaveLength(2);
  });

  it('counts qualified rows', async () => {
    const { repo, service } = setup();
    const out = await service.matchJob('job-1');
    const stored = await repo.matchesForJob('job-1');
    expect(out).toEqual({
      status: 'matched',
      profiles: 2,
      qualified: stored.filter((r) => r.outcome === 'qualified').length,
    });
  });

  it('caches the context for ten minutes', async () => {
    const { repo, service, advance } = setup();
    await service.matchJob('job-1', { force: true });
    advance(9 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(1);
    advance(2 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(2);
  });
});
