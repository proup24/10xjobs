import type { LocationArrangement } from 'src/modules/queries';

/** Where a profile wants to work: the processor's place shape, a city held by its id. */
export type Place =
  | { kind: 'worldwide' }
  | { kind: 'region'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'city'; id: string };

/** Per arrangement, the places wanted. An empty list means that arrangement is not wanted. */
export type PlacesByArrangement = Record<LocationArrangement, Place[]>;

export const LANGUAGE_LEVELS = ['native', 'fluent', 'working'] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/** A language the person speaks: an ISO 639-1 code and how well. */
export type SpokenLanguage = { lang: string; level: LanguageLevel };

export const SALARY_PERIODS = ['hour', 'day', 'month', 'year'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** The lowest salary wanted, in whole units of an ISO 4217 currency per period. */
export type Salary = { min: number; currency: string; period: SalaryPeriod };
