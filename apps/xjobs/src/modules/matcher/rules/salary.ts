import { SALARY_MARGIN } from '../config/matcher.config';
import { convertPay } from './convert';
import { restsOn, type Check, type MatchProfile, type RuleName } from './types';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';

const unsureOf = (facts: JobFactsDocument): string | null =>
  facts.salary.confidence === 'unsure' ? 'salary' : null;

export function checkSalary(
  facts: JobFactsDocument,
  profile: MatchProfile,
  rates: Map<string, number>,
): Check {
  const salary = facts.salary.value;
  const profileValue =
    profile.salaryMin === null
      ? null
      : {
          min: profile.salaryMin,
          currency: profile.salaryCurrency,
          period: profile.salaryPeriod,
        };
  const check = (
    outcome: Check['outcome'],
    reason: string,
    unsureField: string | null = null,
    detail?: unknown,
  ): Check => ({
    rule: 'salary',
    outcome,
    jobValue: salary,
    profileValue,
    reason,
    ...(detail === undefined ? {} : { detail }),
    ...restsOn(unsureField),
  });

  if (
    profile.salaryMin === null ||
    profile.salaryCurrency === null ||
    profile.salaryPeriod === null
  )
    return check('unknown', 'the profile sets no minimum salary');
  if (!salary) return check('unknown', 'job states no salary');
  const best = salary.max ?? salary.min;
  if (best === null) return check('unknown', 'job states no salary amount');
  if (salary.currency === null)
    return check('unknown', 'job salary has no known currency');
  const converted = convertPay(
    best,
    { currency: salary.currency, period: salary.period },
    { currency: profile.salaryCurrency, period: profile.salaryPeriod },
    rates,
  );
  if (converted === null)
    return check(
      'unknown',
      `cannot convert ${salary.currency} to ${profile.salaryCurrency}`,
    );
  const rounded = Math.round(converted);
  const wanted = `${profile.salaryMin} ${profile.salaryCurrency} per ${profile.salaryPeriod}`;
  const detail = { converted: rounded };
  const unsure = unsureOf(facts);
  if (converted >= profile.salaryMin)
    return check(
      'pass',
      `job pays about ${rounded}, at or above your minimum ${wanted}`,
      unsure,
      detail,
    );
  if (converted < profile.salaryMin * (1 - SALARY_MARGIN))
    return check(
      'fail',
      `job pays about ${rounded}, more than ${SALARY_MARGIN * 100}% below your minimum ${wanted}`,
      unsure,
      detail,
    );
  return check(
    'unknown',
    `job pays about ${rounded}, within ${SALARY_MARGIN * 100}% below your minimum ${wanted}`,
    null,
    detail,
  );
}

export function checkCurrency(
  facts: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const currency = facts.salary.value?.currency ?? null;
  const rule: RuleName = 'currency';
  const base = {
    rule,
    jobValue: currency,
    profileValue: profile.acceptsAnyCurrency
      ? 'any'
      : profile.acceptedCurrencies,
  };
  if (currency === null)
    return {
      ...base,
      outcome: 'unknown',
      reason: 'job states no salary currency',
      ...restsOn(null),
    };
  if (profile.acceptsAnyCurrency)
    return {
      ...base,
      outcome: 'pass',
      reason: 'you accept any currency',
      ...restsOn(unsureOf(facts)),
    };
  const accepted = profile.acceptedCurrencies.includes(currency);
  return {
    ...base,
    outcome: accepted ? 'pass' : 'fail',
    reason: accepted
      ? `job pays in ${currency}, which you accept`
      : `job pays in ${currency}; you accept [${profile.acceptedCurrencies.join(', ')}]`,
    ...restsOn(unsureOf(facts)),
  };
}
