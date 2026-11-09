import type { MatcherRepository } from '../repositories/matcher.repository';
import type { MatcherService } from '../services/matcher.service';
import { MatcherController } from './matcher.controller';

const JOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

function controller(
  matcher: Partial<MatcherService>,
  repo: Partial<MatcherRepository>,
) {
  return new MatcherController(
    matcher as MatcherService,
    repo as MatcherRepository,
  );
}

describe('MatcherController', () => {
  it('runs the match with force and returns the outcome with the rows', async () => {
    const rows = [{ profileId: 'p1', outcome: 'qualified' }] as never[];
    const matchJob = vi.fn(async () => ({
      status: 'matched' as const,
      profiles: 1,
      qualified: 1,
    }));
    const result = await controller(
      { matchJob },
      { matchesForJob: async () => rows },
    ).run(JOB);
    expect(matchJob).toHaveBeenCalledWith(JOB, { force: true });
    expect(result).toEqual({
      status: 'matched',
      profiles: 1,
      qualified: 1,
      matches: rows,
    });
  });

  it('answers not_matchable with no rows for a job that is not matchable', async () => {
    const result = await controller(
      { matchJob: async () => ({ status: 'not_matchable' }) },
      { matchesForJob: async () => [] },
    ).run(JOB);
    expect(result).toEqual({ status: 'not_matchable', matches: [] });
  });

  it('lists the stored matches of a job', async () => {
    const rows = [{ profileId: 'p1' }] as never[];
    const matchesForJob = vi.fn(async () => rows);
    expect(await controller({}, { matchesForJob }).matches(JOB)).toEqual({
      matches: rows,
    });
    expect(matchesForJob).toHaveBeenCalledWith(JOB);
  });
});
