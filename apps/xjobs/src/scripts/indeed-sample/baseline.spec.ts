import { describe, expect, it } from 'vitest';
import {
  baselineCost,
  isRelevant,
  PLACE_GROUPS,
  pickBaselineDay,
  type BaselineJob,
  type BaselineRun,
} from './baseline';
import type { PlaceId } from './actors';

const PLACES = Object.keys(PLACE_GROUPS) as PlaceId[];
const TODAY = '2026-11-22';

function run(
  place: PlaceId,
  day: string,
  over: Partial<BaselineRun> = {},
): BaselineRun {
  return {
    place,
    startedAt: new Date(`${day}T10:00:00Z`),
    status: 'succeeded',
    capped: false,
    costMicroUsd: 1_000_000,
    costFinal: true,
    ...over,
  };
}

function fullDay(day: string, count = 1): BaselineRun[] {
  return PLACES.flatMap((p) =>
    Array.from({ length: count }, () => run(p, day)),
  );
}

describe('pickBaselineDay', () => {
  it('returns the latest full day and excludes today', () => {
    const runs = [
      ...fullDay('2026-11-19'),
      ...fullDay('2026-11-21'),
      ...fullDay(TODAY),
    ];
    expect(pickBaselineDay(runs, TODAY).day).toBe('2026-11-21');
  });

  it('skips a day with a run whose cost is not final', () => {
    const runs = [
      ...fullDay('2026-11-20'),
      ...fullDay('2026-11-21').filter((r) => r.place !== 'us-remote'),
      run('us-remote', '2026-11-21', { costFinal: false }),
    ];
    expect(pickBaselineDay(runs, TODAY).day).toBe('2026-11-20');
  });

  it('skips a day with a failed or capped run', () => {
    const runs = [
      ...fullDay('2026-11-19'),
      ...fullDay('2026-11-20').filter((r) => r.place !== 'uk-remote'),
      run('uk-remote', '2026-11-20', { capped: true }),
      ...fullDay('2026-11-21').filter((r) => r.place !== 'ma-onsite'),
      run('ma-onsite', '2026-11-21', { status: 'failed' }),
    ];
    expect(pickBaselineDay(runs, TODAY).day).toBe('2026-11-19');
  });

  it('skips a day with half the usual runs', () => {
    const runs = [...fullDay('2026-11-20', 4), ...fullDay('2026-11-21', 2)];
    expect(pickBaselineDay(runs, TODAY).day).toBe('2026-11-20');
  });

  it('skips a day where one place has no run', () => {
    const runs = [
      ...fullDay('2026-11-20'),
      run('us-remote', '2026-11-21'),
      run('uk-remote', '2026-11-21'),
    ];
    expect(pickBaselineDay(runs, TODAY).day).toBe('2026-11-20');
  });

  it('ignores runs outside the 7-day window', () => {
    const runs = [...fullDay('2026-11-13'), ...fullDay('2026-11-14')];
    const out = pickBaselineDay(runs, TODAY);
    expect(out.day).toBeNull();
  });

  it('gives a reason when no day qualifies', () => {
    const out = pickBaselineDay([], TODAY);
    expect(out.day).toBeNull();
    expect(out.reason).toMatch(/no full day/);
    expect(out.reason).toContain(TODAY);
  });
});

describe('baselineCost', () => {
  const spellings: Record<PlaceId, string[]> = {
    'us-remote': ['typescript'],
    'uk-remote': ['typescript'],
    'ma-onsite': ['typescript'],
  };
  const job = (
    place: PlaceId,
    jobId: string,
    title: string,
    descriptionText: string | null = 'We use TypeScript',
  ): BaselineJob => ({ place, jobId, title, descriptionText });

  it('sums cost and counts distinct relevant jobs per place', () => {
    const runs = [
      run('us-remote', '2026-11-21', { costMicroUsd: 1_500_000 }),
      run('us-remote', '2026-11-21', { costMicroUsd: 500_000 }),
    ];
    const jobs = [
      job('us-remote', 'a', 'Backend Engineer'),
      job('us-remote', 'a', 'Backend Engineer'),
      job('us-remote', 'b', 'Sales Manager'),
      job('us-remote', 'c', 'Software Engineer'),
    ];
    const out = baselineCost(runs, jobs, spellings);
    expect(out['us-remote']).toEqual({
      costUsd: 2,
      relevant: 2,
      perRelevantUsd: 1,
    });
  });

  it('returns null per-relevant cost for zero relevant jobs and empty places', () => {
    const out = baselineCost(
      [run('uk-remote', '2026-11-21')],
      [job('uk-remote', 'x', 'Sales Manager')],
      spellings,
    );
    expect(out['uk-remote']).toEqual({
      costUsd: 1,
      relevant: 0,
      perRelevantUsd: null,
    });
    expect(out['ma-onsite']).toEqual({
      costUsd: 0,
      relevant: 0,
      perRelevantUsd: null,
    });
  });
});

describe('isRelevant', () => {
  it('accepts an engineering title that mentions a spelling', () => {
    expect(
      isRelevant(
        {
          title: 'Senior Backend Engineer',
          descriptionText: 'We use TypeScript',
        },
        ['typescript'],
      ),
    ).toBe(true);
  });
  it('rejects a non-engineering title', () => {
    expect(
      isRelevant(
        { title: 'Sales Manager', descriptionText: 'We use TypeScript' },
        ['typescript'],
      ),
    ).toBe(false);
  });
  it('handles French titles and dotted spellings', () => {
    expect(
      isRelevant(
        { title: 'Développeur Full Stack', descriptionText: 'node.js' },
        ['node.js'],
      ),
    ).toBe(true);
  });
  it('does not match inside a longer word', () => {
    expect(
      isRelevant(
        { title: 'Software Engineer', descriptionText: 'javascripty' },
        ['javascript'],
      ),
    ).toBe(false);
  });
  it('uses the other field when one is null, and false without spellings', () => {
    expect(
      isRelevant({ title: 'Software Engineer', descriptionText: null }, [
        'software',
      ]),
    ).toBe(true);
    expect(
      isRelevant({ title: null, descriptionText: 'engineer ts' }, ['ts']),
    ).toBe(true);
    expect(isRelevant({ title: null, descriptionText: null }, ['ts'])).toBe(
      false,
    );
    expect(
      isRelevant({ title: 'Software Engineer', descriptionText: 'x' }, []),
    ).toBe(false);
  });
});
