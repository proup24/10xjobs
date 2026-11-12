import { describe, expect, it } from 'vitest';
import { outcomeShares } from './shares';

describe('outcomeShares', () => {
  it('counts shares per outcome, review rule and field', () => {
    const shares = outcomeShares([
      { outcome: 'qualified', reviewRule: null, reviewField: null },
      { outcome: 'rejected', reviewRule: null, reviewField: null },
      { outcome: 'review', reviewRule: 'stack', reviewField: 'techStack' },
      { outcome: 'review', reviewRule: 'stack', reviewField: 'techStack' },
      { outcome: 'review', reviewRule: 'location', reviewField: 'country' },
    ]);
    expect(shares.total).toBe(5);
    expect(shares.byOutcome).toEqual({
      qualified: 0.2,
      rejected: 0.2,
      review: 0.6,
    });
    expect(shares.reviewByRule).toEqual({ stack: 2 / 3, location: 1 / 3 });
    expect(shares.reviewByField).toEqual({ techStack: 2 / 3, country: 1 / 3 });
  });

  it('returns empty shares for no rows', () => {
    expect(outcomeShares([])).toEqual({
      total: 0,
      byOutcome: {},
      reviewByRule: {},
      reviewByField: {},
    });
  });

  it('has empty review shares and no NaN without review rows', () => {
    const shares = outcomeShares([
      { outcome: 'qualified', reviewRule: null, reviewField: null },
      { outcome: 'rejected', reviewRule: null, reviewField: null },
    ]);
    expect(shares.byOutcome).toEqual({ qualified: 0.5, rejected: 0.5 });
    expect(shares.reviewByRule).toEqual({});
    expect(shares.reviewByField).toEqual({});
  });
});
