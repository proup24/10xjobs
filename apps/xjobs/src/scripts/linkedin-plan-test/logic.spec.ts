import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';
import {
  TOTAL_BUDGET_USD,
  createBudget,
  containmentVerdict,
  keywordOfLength,
  orForms,
  publishedAtStats,
} from './logic';

describe('createBudget', () => {
  it('allows runs until the total would pass the budget', () => {
    const budget = createBudget(1);
    budget.reserve(0.4);
    budget.reserve(0.6);
    expect(budget.spent()).toBeCloseTo(1);
  });

  it('refuses a run that would push the total past the budget, without counting it', () => {
    const budget = createBudget(1);
    budget.reserve(0.7);
    expect(() => budget.reserve(0.31)).toThrow(/budget/i);
    expect(budget.spent()).toBeCloseTo(0.7);
    budget.reserve(0.3);
  });

  it('defaults to a one dollar budget', () => {
    expect(TOTAL_BUDGET_USD).toBe(1);
    expect(() => createBudget().reserve(1.01)).toThrow();
  });
});

describe('orForms', () => {
  it('builds the three OR spellings', () => {
    expect(orForms(['nestjs', 'next js'])).toEqual({
      quoted: 'nestjs OR "next js"',
      parenthesised: 'nestjs OR (next js)',
      bare: 'nestjs OR next js',
    });
  });

  it('leaves single words unquoted in every form', () => {
    expect(orForms(['go', 'rust']).quoted).toBe('go OR rust');
  });
});

describe('keywordOfLength', () => {
  const terms = Object.values(TECHNOLOGY_TERMS);

  it.each([100, 200, 400, 800])('fits %i chars without passing them', (n) => {
    const keyword = keywordOfLength(n);
    expect(keyword.length).toBeLessThanOrEqual(n);
    expect(keyword.length).toBeGreaterThan(n * 0.8);
    const parts = keyword.split(' OR ');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(terms).toContain(part);
  });
});

describe('containmentVerdict', () => {
  const at = (day: number) => `2026-11-0${day}T10:00:00.000Z`;

  it('passes when the parent holds every child job', () => {
    const result = containmentVerdict(
      [{ id: 'a', publishedAt: at(5) }],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(4) },
      ],
    );
    expect(result).toEqual({ verdict: 'pass', missing: [] });
  });

  it('is a row-limit cut when every missing job is older than the parent oldest', () => {
    const result = containmentVerdict(
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'old', publishedAt: at(1) },
      ],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(3) },
      ],
    );
    expect(result).toEqual({ verdict: 'row-limit-cut', missing: ['old'] });
  });

  it('fails when a missing job is newer than the parent oldest', () => {
    const result = containmentVerdict(
      [{ id: 'new', publishedAt: at(6) }],
      [{ id: 'b', publishedAt: at(3) }],
    );
    expect(result).toEqual({ verdict: 'fail', missing: ['new'] });
  });

  it('fails when a missing job has no usable date', () => {
    const result = containmentVerdict(
      [{ id: 'x', publishedAt: null }],
      [{ id: 'b', publishedAt: at(3) }],
    );
    expect(result.verdict).toBe('fail');
  });

  it('fails when the parent is empty and the child is not', () => {
    expect(
      containmentVerdict([{ id: 'x', publishedAt: at(2) }], []).verdict,
    ).toBe('fail');
  });
});

describe('publishedAtStats', () => {
  it('counts parseable dates and non-midnight UTC times', () => {
    const stats = publishedAtStats([
      { publishedAt: '2026-11-05T10:15:00.000Z' },
      { publishedAt: '2026-11-05' },
      { publishedAt: 'not a date' },
      {},
    ]);
    expect(stats).toEqual({
      total: 4,
      parseableShare: 0.5,
      nonMidnightShare: 0.25,
    });
  });

  it('is zero for no items', () => {
    expect(publishedAtStats([])).toEqual({
      total: 0,
      parseableShare: 0,
      nonMidnightShare: 0,
    });
  });
});
