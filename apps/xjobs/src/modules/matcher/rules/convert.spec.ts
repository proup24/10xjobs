import { describe, expect, it } from 'vitest';
import { convertPay } from './convert';

const rates = new Map([
  ['USD', 1],
  ['EUR', 0.9],
  ['MAD', 10],
]);

describe('convertPay', () => {
  it('50 USD per hour is 104000 USD per year', () => {
    expect(
      convertPay(
        50,
        { currency: 'USD', period: 'hour' },
        { currency: 'USD', period: 'year' },
        rates,
      ),
    ).toBe(104000);
  });

  it('a month is a year over 12', () => {
    expect(
      convertPay(
        1200,
        { currency: 'USD', period: 'month' },
        { currency: 'USD', period: 'year' },
        rates,
      ),
    ).toBe(14400);
    expect(
      convertPay(
        260,
        { currency: 'USD', period: 'day' },
        { currency: 'USD', period: 'year' },
        rates,
      ),
    ).toBe(67600);
  });

  it('converts EUR to MAD through USD rates', () => {
    const out = convertPay(
      90,
      { currency: 'EUR', period: 'year' },
      { currency: 'MAD', period: 'year' },
      rates,
    );
    expect(out).toBeCloseTo(1000);
  });

  it('an unknown currency is null', () => {
    expect(
      convertPay(
        1,
        { currency: 'XXX', period: 'year' },
        { currency: 'USD', period: 'year' },
        rates,
      ),
    ).toBeNull();
  });
});
