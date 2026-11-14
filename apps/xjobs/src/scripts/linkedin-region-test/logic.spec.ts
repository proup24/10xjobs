import { describe, expect, it } from 'vitest';
import { type PlaceRun, judgePair, runCapUsd } from './logic';

const HOUR = 3600 * 1000;
const start = Date.parse('2026-11-14T12:00:00Z');

function run(
  place: string,
  jobs: [string, number][],
  rows = 150,
  startedMs = start,
): PlaceRun {
  return {
    place,
    ok: true,
    startedMs,
    rows,
    total: jobs.length,
    jobs: jobs.map(([id, hoursAgo]) => ({
      id,
      postedMs: start - hoursAgo * HOUR,
      title: 'Engineer',
      location: null,
      jobFunctions: [],
      industries: [],
      query: null,
    })),
  };
}

const five = (prefix: string): [string, number][] =>
  [1, 2, 3, 4, 5].map((h) => [`${prefix}${h}`, h]);

describe('judgePair', () => {
  it('passes when every child job is in the parent', () => {
    const result = judgePair(
      run('morocco', five('m')),
      run('emea', [...five('m'), ['x', 1]]),
    );
    expect(result.verdict).toBe('pass');
    expect(result.compared).toBe(5);
  });

  it('fails and names the missing job', () => {
    const result = judgePair(
      run('europe', five('e')),
      run('emea', five('e').slice(1)),
    );
    expect(result.verdict).toBe('fail');
    expect(result.missing.map((m) => m.id)).toEqual(['e1']);
  });

  it('ignores child jobs older than a full parent saw', () => {
    // The parent hit its 3-row cap at 3 hours ago, so e4 and e5 are not compared.
    const parent = run(
      'emea',
      [
        ['e1', 1],
        ['e2', 2],
        ['e3', 3],
      ],
      3,
    );
    const result = judgePair(run('europe', five('e')), parent);
    expect(result.compared).toBe(3);
    expect(result.missing).toEqual([]);
  });

  it('ignores child jobs posted after the earlier run started', () => {
    const child = run('morocco', [...five('m'), ['late', -1]]);
    const result = judgePair(child, run('emea', five('m')));
    expect(result.verdict).toBe('pass');
  });

  it('is too few on a small overlap, and invalid on a failed run', () => {
    expect(
      judgePair(run('a', [['a1', 1]]), run('b', [['a1', 1]])).verdict,
    ).toBe('too-few');
    expect(
      judgePair({ ...run('a', five('a')), ok: false }, run('b', five('a')))
        .verdict,
    ).toBe('invalid');
  });
});

describe('runCapUsd', () => {
  it('covers the start and every row of every place', () => {
    expect(runCapUsd(150)).toBeCloseTo(0.156);
    expect(runCapUsd(15, 3)).toBeCloseTo(0.051);
  });
});
