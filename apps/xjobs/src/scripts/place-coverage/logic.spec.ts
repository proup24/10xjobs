import { describe, expect, it } from 'vitest';
import {
  bestOutcome,
  placeCoverage,
  type Outcome,
  type PlaceRun,
  type Sighting,
} from './logic';

const sight = (
  jobId: string,
  place: string,
  type = 'remote',
  level: string | null = null,
): Sighting => ({ jobId, place, type, level });
const run = (
  place: string,
  type = 'remote',
  level: string | null = null,
  costMicroUsd: number | null = 0,
): PlaceRun => ({ place, type, level, costMicroUsd });
const none = new Map<string, Outcome | 'none'>();

describe('bestOutcome', () => {
  it('ranks qualified over review over rejected over none', () => {
    expect(bestOutcome(['rejected', 'qualified'])).toBe('qualified');
    expect(bestOutcome(['rejected', 'review'])).toBe('review');
    expect(bestOutcome(['rejected'])).toBe('rejected');
    expect(bestOutcome([])).toBe('none');
  });
});

describe('placeCoverage', () => {
  it('does not count a shared job as only here, and each place counts its own', () => {
    const rows = placeCoverage(
      [sight('a', 'france'), sight('a', 'germany'), sight('b', 'france')],
      [],
      none,
      'type',
    );
    const france = rows.find((r) => r.place === 'france');
    const germany = rows.find((r) => r.place === 'germany');
    expect(france?.jobs).toBe(2);
    expect(france?.onlyHere).toBe(1);
    expect(germany?.jobs).toBe(1);
    expect(germany?.onlyHere).toBe(0);
  });

  it('counts a job found by two types of the same place as only here in both', () => {
    const rows = placeCoverage(
      [sight('a', 'europe', 'remote'), sight('a', 'europe', 'hybrid')],
      [],
      none,
      'type',
    );
    expect(rows.map((r) => [r.type, r.onlyHere])).toEqual([
      ['remote', 1],
      ['hybrid', 1],
    ]);
  });

  it('groups on level, with the null level as its own row', () => {
    const rows = placeCoverage(
      [
        sight('a', 'europe', 'remote', 'senior'),
        sight('b', 'europe', 'remote'),
      ],
      [],
      none,
      'level',
    );
    expect(rows.map((r) => r.level).sort()).toEqual([null, 'senior']);
    expect(rows.every((r) => r.onlyHere === 1)).toBe(true);
  });

  it('adds runs and cost per row, a null cost adding zero', () => {
    const rows = placeCoverage(
      [sight('a', 'europe')],
      [
        run('europe', 'remote', null, 1_500_000),
        run('europe', 'remote', null, null),
        run('europe', 'hybrid', null, 999),
      ],
      none,
      'type',
    );
    const remote = rows.find((r) => r.type === 'remote');
    expect(remote?.runs).toBe(2);
    expect(remote?.costUsd).toBeCloseTo(1.5);
  });

  it('tallies the best outcome of only-here jobs and sorts by onlyHere', () => {
    const outcomes = new Map<string, Outcome | 'none'>([
      ['a', 'qualified'],
      ['b', 'rejected'],
    ]);
    const rows = placeCoverage(
      [
        sight('a', 'france'),
        sight('b', 'france'),
        sight('c', 'france'),
        sight('d', 'germany'),
      ],
      [],
      outcomes,
      'type',
    );
    expect(rows[0].place).toBe('france');
    expect(rows[0].onlyHereOutcomes).toEqual({
      qualified: 1,
      review: 0,
      rejected: 1,
      none: 1,
    });
  });
});
