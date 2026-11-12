import {
  HOURS_PER_DAY,
  HOURS_PER_YEAR,
  MONTHS_PER_YEAR,
} from '../config/matcher.config';

export type Period = 'hour' | 'day' | 'month' | 'year';

/** How many of each period make a year. */
const PER_YEAR: Record<Period, number> = {
  hour: HOURS_PER_YEAR,
  day: HOURS_PER_YEAR / HOURS_PER_DAY,
  month: MONTHS_PER_YEAR,
  year: 1,
};

/**
 * Converts a pay between currencies and periods. `rates` are units of each currency per
 * one USD. Null when a needed currency has no usable rate.
 */
export function convertPay(
  amount: number,
  from: { currency: string; period: Period },
  to: { currency: string; period: Period },
  rates: Map<string, number>,
): number | null {
  let value = (amount * PER_YEAR[from.period]) / PER_YEAR[to.period];
  if (from.currency === to.currency) return value;
  const fromRate = rates.get(from.currency);
  const toRate = rates.get(to.currency);
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return null;
  value = (value / fromRate) * toRate;
  return value;
}
