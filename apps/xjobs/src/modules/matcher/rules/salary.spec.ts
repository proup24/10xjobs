import { describe, expect, it } from 'vitest';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { exampleProfile, factsDoc } from './fixtures.testing';
import { checkCurrency, checkSalary } from './salary';
import type { MatchProfile } from './types';

const rates = new Map([
  ['USD', 1],
  ['EUR', 0.9],
]);

const profile = (p: Partial<MatchProfile> = {}): MatchProfile => ({
  ...exampleProfile(),
  salaryMin: 100000,
  salaryCurrency: 'USD',
  salaryPeriod: 'year',
  ...p,
});

type Salary = NonNullable<JobFactsDocument['salary']['value']>;
const doc = (
  salary: Partial<Salary> | null,
  confidence: 'sure' | 'unsure' = 'sure',
) =>
  factsDoc((d) => {
    d.salary = {
      value: salary && {
        min: null,
        max: null,
        currency: 'USD',
        period: 'year',
        ...salary,
      },
      confidence,
      source: 'description',
      quote: '',
    };
  });

describe('checkSalary', () => {
  it('pass at or above the minimum', () => {
    const c = checkSalary(doc({ max: 100000 }), profile(), rates);
    expect(c).toMatchObject({ rule: 'salary', outcome: 'pass', unsure: false });
  });

  it('fail more than 10% below', () => {
    const c = checkSalary(doc({ max: 89000 }), profile(), rates);
    expect(c).toMatchObject({ outcome: 'fail', unsure: false });
  });

  it('unknown within the margin', () => {
    const c = checkSalary(doc({ max: 95000 }), profile(), rates);
    expect(c.outcome).toBe('unknown');
  });

  it('uses max, else min', () => {
    expect(
      checkSalary(doc({ min: 50000, max: 120000 }), profile(), rates).outcome,
    ).toBe('pass');
    expect(checkSalary(doc({ min: 50000 }), profile(), rates).outcome).toBe(
      'fail',
    );
  });

  it('converts periods and currencies', () => {
    expect(
      checkSalary(doc({ max: 60, period: 'hour' }), profile(), rates).outcome,
    ).toBe('pass');
    expect(
      checkSalary(doc({ max: 90000, currency: 'EUR' }), profile(), rates)
        .outcome,
    ).toBe('pass');
  });

  it('unknown with no salary', () => {
    expect(checkSalary(doc(null), profile(), rates).outcome).toBe('unknown');
    expect(checkSalary(doc({}), profile(), rates).outcome).toBe('unknown');
  });

  it("unknown when it can't convert", () => {
    expect(
      checkSalary(doc({ max: 1, currency: 'XXX' }), profile(), rates).outcome,
    ).toBe('unknown');
    expect(
      checkSalary(doc({ max: 1, currency: null }), profile(), rates).outcome,
    ).toBe('unknown');
  });

  it('unknown when the profile has no minimum', () => {
    const p = profile({
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
    expect(checkSalary(doc({ max: 1 }), p, rates).outcome).toBe('unknown');
  });

  it('an unsure salary failure is unsure', () => {
    const c = checkSalary(doc({ max: 10 }, 'unsure'), profile(), rates);
    expect(c).toMatchObject({
      outcome: 'fail',
      unsure: true,
      unsureField: 'salary',
    });
  });
});

describe('checkSalary with no usable amount', () => {
  it('a best pay of zero or less is unknown, never a fail', () => {
    for (const max of [0, -5]) {
      const c = checkSalary(doc({ max }), profile(), rates);
      expect(c).toMatchObject({ outcome: 'unknown', unsure: false });
      expect(c.reason).toBe('the job states no usable amount');
    }
    expect(checkSalary(doc({ min: 0 }), profile(), rates).outcome).toBe(
      'unknown',
    );
  });
});

describe('checkCurrency', () => {
  const only = profile({
    acceptsAnyCurrency: false,
    acceptedCurrencies: ['USD'],
  });

  it('fail when the currency is not accepted', () => {
    expect(checkCurrency(doc({ currency: 'EUR' }), only)).toMatchObject({
      rule: 'currency',
      outcome: 'fail',
      unsure: false,
    });
    expect(
      checkCurrency(doc({ currency: 'EUR' }, 'unsure'), only),
    ).toMatchObject({ unsure: true, unsureField: 'salary' });
  });

  it('pass when accepted, or when any is accepted', () => {
    expect(checkCurrency(doc({ currency: 'USD' }), only).outcome).toBe('pass');
    expect(checkCurrency(doc({ currency: 'EUR' }), profile()).outcome).toBe(
      'pass',
    );
  });

  it('accepting any currency passes surely, even on an unsure salary', () => {
    expect(
      checkCurrency(doc({ currency: 'EUR' }, 'unsure'), profile()),
    ).toMatchObject({ outcome: 'pass', unsure: false, unsureField: null });
  });

  it('unknown when no currency is stated', () => {
    expect(checkCurrency(doc({ currency: null }), only).outcome).toBe(
      'unknown',
    );
    expect(checkCurrency(doc(null), only).outcome).toBe('unknown');
  });
});
