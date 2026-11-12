import type { PlaceVocabulary } from 'src/modules/facts/places/resolver';
import { combineFacts } from 'src/modules/facts/rules/combine';
import { listingFacts, type ListingRow } from 'src/modules/facts/rules/listing';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import type { MatchProfile } from './types';

export const CITY_A = '00000000-0000-4000-8000-00000000000a';
export const CITY_B = '00000000-0000-4000-8000-00000000000b';

export function exampleProfile(): MatchProfile {
  const skill = (technology: string, mastery: number, importance: number) => ({
    technology,
    mastery,
    importance,
  });
  return {
    id: 'profile-1',
    userId: 'user-1',
    position: 'backend_engineer',
    seniorities: ['senior'],
    yearsOfExperience: 5,
    timezoneMin: -300,
    timezoneMax: 300,
    locations: {
      remote: [{ kind: 'worldwide' }],
      hybrid: [
        { kind: 'city', id: CITY_A },
        { kind: 'city', id: CITY_B },
      ],
      onsite: [
        { kind: 'city', id: CITY_A },
        { kind: 'city', id: CITY_B },
      ],
    },
    skills: [
      skill('python', 9, 10),
      skill('nestjs', 9, 10),
      skill('go', 8, 10),
      skill('rabbitmq', 10, 8),
      skill('postgresql', 8, 8),
      skill('redis', 7, 6),
      skill('docker', 7, 6),
      skill('aws', 6, 5),
    ],
    salaryMin: null,
    salaryCurrency: null,
    salaryPeriod: null,
    acceptsAnyCurrency: true,
    acceptedCurrencies: [],
  };
}

const EMPTY_VOCAB: PlaceVocabulary = {
  regions: new Set(),
  countries: new Set(),
  cities: new Map(),
  cityNames: new Map(),
  regionCountries: new Map(),
};

const EMPTY_LISTING: ListingRow = {
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
};

/** The facts of the fixture extraction with an empty listing, with `edit` applied. */
export function factsDoc(
  edit?: (doc: JobFactsDocument) => void,
): JobFactsDocument {
  const { facts } = combineFacts({
    extraction: fixtureDocument(),
    listing: listingFacts(EMPTY_LISTING, EMPTY_VOCAB),
    vocab: EMPTY_VOCAB,
    now: new Date('2026-11-12T00:00:00Z'),
  });
  const doc = structuredClone(facts);
  edit?.(doc);
  return doc;
}
