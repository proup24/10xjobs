import { mapHarvestJob } from '../../ingest/normalize/mappers/harvest-job.mapper';
import harvest from '../../ingest/utils/fixtures/linkedin-job-harvest.json';
import type { PlaceVocabulary } from '../places/resolver';
import { cleanCurrency, ISO_4217 } from './currency';
import { listingFacts, type ListingRow } from './listing';

const vocab: PlaceVocabulary = {
  regions: new Set(['EU']),
  countries: new Set(['FR', 'US', 'MA']),
  cities: new Map([['FR|paris', 'c-paris']]),
  cityNames: new Map([['c-paris', 'Paris']]),
  regionCountries: new Map([['EU', new Set(['FR'])]]),
};

const row = (p: Partial<ListingRow> = {}): ListingRow => ({
  workplaceType: null,
  countryCode: null,
  regionCode: null,
  city: null,
  geoId: null,
  location: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryProvidedByEmployer: null,
  experienceLevel: null,
  contractType: null,
  expiresAt: null,
  ...p,
});

const employerSalary = {
  salaryMin: 5000,
  salaryMax: 7000,
  salaryCurrency: 'EUR',
  salaryPeriod: 'MONTHLY',
  salaryProvidedByEmployer: true,
};

describe('currency', () => {
  it('knows the active codes we rely on', () => {
    for (const code of ['MAD', 'EUR', 'USD', 'GBP']) {
      expect(ISO_4217.has(code)).toBe(true);
    }
  });
  it('cleans a code and drops an unknown one', () => {
    expect(cleanCurrency(' eur ')).toBe('EUR');
    expect(cleanCurrency('XYZ')).toBeNull();
    expect(cleanCurrency(null)).toBeNull();
  });
});

describe('listingFacts', () => {
  it('maps MONTHLY to month and keeps an employer salary', () => {
    expect(listingFacts(row(employerSalary), vocab).salary).toEqual({
      min: 5000,
      max: 7000,
      currency: 'EUR',
      period: 'month',
    });
  });

  it('drops a salary not provided by the employer', () => {
    for (const salaryProvidedByEmployer of [false, null]) {
      expect(
        listingFacts(
          row({ ...employerSalary, salaryProvidedByEmployer }),
          vocab,
        ).salary,
      ).toBeNull();
    }
  });

  it('drops a salary with an unknown period', () => {
    for (const salaryPeriod of ['WEEKLY', 'ANNUAL', 'monthly', 'year', null]) {
      expect(
        listingFacts(row({ ...employerSalary, salaryPeriod }), vocab).salary,
      ).toBeNull();
    }
  });

  it('drops an unknown currency but keeps the amounts', () => {
    expect(
      listingFacts(row({ ...employerSalary, salaryCurrency: 'XYZ' }), vocab)
        .salary,
    ).toEqual({ min: 5000, max: 7000, currency: null, period: 'month' });
  });

  it('an on_site item is onsite', () => {
    const item = harvest.find((j) => j.workplaceType === 'on_site');
    expect(item).toBeDefined();
    const record = mapHarvestJob(item as Record<string, unknown>, {
      scrapedAt: new Date(),
    });
    expect(record.workplaceType).toBe('onsite');
    expect(
      listingFacts(row({ workplaceType: record.workplaceType }), vocab)
        .arrangement,
    ).toBe('onsite');
  });

  it('resolves the place and passes the display fields through', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    expect(
      listingFacts(
        row({
          workplaceType: 'hybrid',
          countryCode: 'FR',
          city: 'Paris',
          location: 'Paris, Île-de-France, France',
          experienceLevel: 'Mid-Senior level',
          contractType: 'Full-time',
          expiresAt,
        }),
        vocab,
      ),
    ).toEqual({
      arrangement: 'hybrid',
      place: {
        kind: 'city',
        name: 'Paris',
        countryCode: 'FR',
        cityId: 'c-paris',
      },
      locationText: 'Paris, Île-de-France, France',
      salary: null,
      experienceLevel: 'Mid-Senior level',
      contractText: 'Full-time',
      expiresAt,
    });
  });
});
