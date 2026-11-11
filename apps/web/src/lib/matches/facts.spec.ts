import { describe, expect, it } from 'vitest';
import { arrangementLine, factLines, salaryLine, stackLines } from './facts';

const noSalary = {
  salaryText: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
} as unknown as Parameters<typeof salaryLine>[0];

describe('salaryLine', () => {
  it('prefers the job text, then its range, then the extracted salary', () => {
    expect(salaryLine({ ...noSalary, salaryText: '€80k', facts: null })).toBe(
      '€80k',
    );
    expect(
      salaryLine({
        ...noSalary,
        salaryMin: 70000,
        salaryMax: 90000,
        salaryCurrency: 'EUR',
        salaryPeriod: 'year',
        facts: null,
      } as Parameters<typeof salaryLine>[0]),
    ).toBe('EUR 70k–90k per year');
    expect(
      salaryLine({
        ...noSalary,
        facts: {
          salary: { min: 500, max: null, currency: 'USD', period: 'day' },
        },
      }),
    ).toBe('USD 500+ per day');
    expect(salaryLine({ ...noSalary, facts: {} })).toBeNull();
  });
});

describe('factLines', () => {
  it('is all null for an empty extraction', () => {
    expect(factLines({ ...noSalary, facts: null })).toEqual({
      role: null,
      seniority: null,
      arrangement: null,
      places: null,
      contractType: null,
      engagement: null,
      salary: null,
    });
  });

  it("reads the value lists' unstated code as not stated", () => {
    const unstated = { code: 'unstated', label: 'Unstated', quote: null };
    const facts = {
      position: {
        roleKind: { code: 'unstated', label: 'Unstated' },
        title: 'Senior Engineer, Core Services',
      },
      seniority: unstated,
      arrangement: unstated,
      contractType: unstated,
      engagement: unstated,
      openings: [],
    };
    expect(factLines({ ...noSalary, facts })).toEqual({
      role: 'Senior Engineer, Core Services',
      seniority: null,
      arrangement: null,
      places: null,
      contractType: null,
      engagement: null,
      salary: null,
    });
    expect(arrangementLine(facts)).toBeNull();
  });

  it('falls back to the openings for the arrangement, and words worldwide', () => {
    const facts = {
      openings: [
        {
          arrangements: [{ code: 'hybrid', label: 'Hybrid' }],
          places: [{ kind: 'worldwide' }],
          timezones: [],
        },
      ],
    };
    expect(arrangementLine(facts)).toBe('Hybrid');
    expect(factLines({ ...noSalary, facts }).places).toBe('Worldwide');
  });
});

describe('stackLines', () => {
  it('labels each code of a unit and keeps uncompared text as is', () => {
    const checks = [
      {
        rule: 'stack',
        detail: {
          covered: ['react or vue'],
          uncovered: ['go'],
          niceCovered: ['docker'],
          notComparable: ['Kubernetes'],
        },
      },
    ];
    const label = (c: string) => c.toUpperCase();
    expect(stackLines(checks, label)).toEqual({
      covered: ['REACT or VUE', 'DOCKER'],
      uncovered: ['GO'],
      notCompared: ['Kubernetes'],
    });
    expect(stackLines(null, label)).toEqual({
      covered: [],
      uncovered: [],
      notCompared: [],
    });
  });
});
