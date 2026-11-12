import {
  resolveListingPlace,
  type PlaceVocabulary,
  type ResolvedPlace,
} from '../places/resolver';
import type { FactSalary } from '../schema/facts';
import { cleanCurrency } from './currency';

/** The `normalized_jobs` columns the listing facts read. */
export interface ListingRow {
  /** Already mapped in ingest: LinkedIn's `on_site` is stored as `onsite`. */
  workplaceType: 'remote' | 'hybrid' | 'onsite' | null;
  countryCode: string | null;
  regionCode: string | null;
  city: string | null;
  geoId: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryProvidedByEmployer: boolean | null;
  experienceLevel: string | null;
  /** LinkedIn's contract text (`Full-time`, `Contract`), the keys of `LINKEDIN_CONTRACT_TYPES`. */
  contractType: string | null;
  expiresAt: Date | null;
}

export interface ListingFacts {
  arrangement: string | null;
  place: ResolvedPlace | null;
  locationText: string | null;
  salary: FactSalary | null;
  experienceLevel: string | null;
  contractText: string | null;
  expiresAt: Date | null;
}

/** LinkedIn pay periods; any other period drops the salary. */
const PERIODS: Record<string, FactSalary['period']> = {
  HOURLY: 'hour',
  DAILY: 'day',
  MONTHLY: 'month',
  YEARLY: 'year',
};

/** An employer-provided salary with a known period; an unknown currency becomes null. */
function listingSalary(row: ListingRow): FactSalary | null {
  if (row.salaryProvidedByEmployer !== true) return null;
  if (row.salaryMin === null && row.salaryMax === null) return null;
  const period =
    row.salaryPeriod !== null && Object.hasOwn(PERIODS, row.salaryPeriod)
      ? PERIODS[row.salaryPeriod]
      : undefined;
  if (!period) return null;
  return {
    min: row.salaryMin,
    max: row.salaryMax,
    currency: cleanCurrency(row.salaryCurrency),
    period,
  };
}

/** What a LinkedIn listing says, cleaned: the inputs `combineFacts` reads. */
export function listingFacts(
  row: ListingRow,
  vocab: PlaceVocabulary,
): ListingFacts {
  return {
    arrangement: row.workplaceType,
    place: resolveListingPlace(row, vocab).place,
    locationText: row.location,
    salary: listingSalary(row),
    experienceLevel: row.experienceLevel,
    contractText: row.contractType,
    expiresAt: row.expiresAt,
  };
}
