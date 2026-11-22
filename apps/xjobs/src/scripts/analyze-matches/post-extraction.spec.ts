import { shapePostExtraction } from './post-extraction';

const now = new Date('2026-11-22T10:00:00Z');

describe('shapePostExtraction', () => {
  it('shows the last 7 UTC days, newest first, zeros for empty days', () => {
    const rows = shapePostExtraction([], now);
    expect(rows.map((r) => r.day)).toEqual([
      '2026-11-22',
      '2026-11-21',
      '2026-11-20',
      '2026-11-19',
      '2026-11-18',
      '2026-11-17',
      '2026-11-16',
    ]);
    expect(rows[3]).toEqual({
      day: '2026-11-19',
      calls: 0,
      cost_usd: 0,
      hiring_sure: 0,
      hiring_unsure: 0,
      not_hiring_sure: 0,
      not_hiring_unsure: 0,
      junk_sure: 0,
      junk_unsure: 0,
      role_jobs: 0,
      left_window_pending: 0,
    });
  });

  it('places each figure on its day and ignores days outside the window', () => {
    const rows = shapePostExtraction(
      [
        { day: '2026-11-22', metric: 'calls', n: 4, cost: 0.1234 },
        { day: '2026-11-22', metric: 'hiring/sure', n: 2, cost: 0 },
        { day: '2026-11-22', metric: 'hiring/unsure', n: 1, cost: 0 },
        { day: '2026-11-21', metric: 'junk/sure', n: 3, cost: 0 },
        { day: '2026-11-21', metric: 'not_hiring/unsure', n: 5, cost: 0 },
        { day: '2026-11-20', metric: 'not_hiring/sure', n: 6, cost: 0 },
        { day: '2026-11-20', metric: 'junk/unsure', n: 7, cost: 0 },
        { day: '2026-11-20', metric: 'roles', n: 8, cost: 0 },
        { day: '2026-11-16', metric: 'left_window_pending', n: 9, cost: 0 },
        { day: '2026-11-15', metric: 'calls', n: 99, cost: 9 },
      ],
      now,
    );
    expect(rows[0]).toMatchObject({
      calls: 4,
      cost_usd: 0.1234,
      hiring_sure: 2,
      hiring_unsure: 1,
    });
    expect(rows[1]).toMatchObject({ junk_sure: 3, not_hiring_unsure: 5 });
    expect(rows[2]).toMatchObject({
      not_hiring_sure: 6,
      junk_unsure: 7,
      role_jobs: 8,
    });
    expect(rows[6]).toMatchObject({ left_window_pending: 9 });
    expect(rows.reduce((n, r) => n + r.calls, 0)).toBe(4);
  });
});
