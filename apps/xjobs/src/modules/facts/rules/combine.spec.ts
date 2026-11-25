import type {
  ExtractionDocument,
  Opening,
} from '../../processor/schema/extraction';
import { fixtureDocument } from '../../processor/schema/fixture.testing';
import { LIMITS_BIND_PERSON_SINCE } from '../config/facts.config';
import type { PlaceVocabulary } from '../places/resolver';
import { jobFactsDocumentSchema } from '../schema/facts';
import { combineFacts } from './combine';
import type { ListingFacts } from './listing';

const vocab: PlaceVocabulary = {
  regions: new Set(['EU', 'EMEA', 'NORTH_AMERICA']),
  countries: new Set(['FR', 'US', 'DE']),
  cities: new Map([
    ['FR|paris', 'c-paris'],
    ['FR|lyon', 'c-lyon'],
  ]),
  countryNames: new Map(),
  cityCountries: new Map(),
  cityNames: new Map([
    ['c-paris', 'Paris'],
    ['c-lyon', 'Lyon'],
  ]),
  regionCountries: new Map([
    ['EU', new Set(['FR', 'DE'])],
    ['EMEA', new Set(['FR', 'DE', 'MA'])],
    ['NORTH_AMERICA', new Set(['US'])],
  ]),
};

const NOW = new Date('2026-11-12T12:00:00Z');

const listing = (p: Partial<ListingFacts> = {}): ListingFacts => ({
  arrangement: null,
  place: null,
  locationText: null,
  salary: null,
  experienceLevel: null,
  contractText: null,
  expiresAt: null,
  ...p,
});

const opening = (p: Partial<Opening> = {}): Opening => ({
  arrangements: ['unstated'],
  places: [],
  placeStrictness: 'unstated',
  timezones: [],
  quote: '',
  confidence: 'sure',
  decidedBy: 'generator',
  ...p,
});

const paris: Opening['places'][number] = {
  kind: 'city',
  name: 'Paris',
  countryCode: 'FR',
  cityId: null,
};

function doc(
  p: Partial<ExtractionDocument> & { arrangementValue?: string } = {},
): ExtractionDocument {
  const base = fixtureDocument();
  const { arrangementValue, ...rest } = p;
  if (arrangementValue !== undefined)
    base.arrangement = {
      ...base.arrangement,
      value: arrangementValue,
      quote: `${arrangementValue} quote`,
    };
  return { ...base, ...rest };
}

const combine = (
  extraction: ExtractionDocument,
  l: ListingFacts,
  extractedAt = NOW,
) =>
  combineFacts({
    extraction,
    listing: l,
    vocab,
    now: NOW,
    extractedAt,
    descriptionText: null,
  });

describe('combineFacts', () => {
  it('description arrangement wins and a disagreement is a conflict', () => {
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'hybrid',
        openings: [
          opening({ arrangements: ['hybrid'], quote: 'hybrid in Paris' }),
          opening({ arrangements: ['unstated'], quote: 'also hiring' }),
        ],
      }),
      listing({ arrangement: 'onsite' }),
    );
    expect(facts.arrangement).toMatchObject({
      value: 'hybrid',
      source: 'description',
    });
    expect(conflicts).toEqual([
      {
        field: 'arrangement',
        listingValue: 'onsite',
        descriptionValue: ['hybrid'],
        quote: 'hybrid in Paris',
        winner: 'description',
      },
    ]);
  });

  it('listing fills an unstated arrangement', () => {
    const { facts, conflicts } = combine(
      doc({ arrangementValue: 'unstated', openings: [opening()] }),
      listing({
        arrangement: 'remote',
        place: { kind: 'country', code: 'US' },
        locationText: 'United States',
      }),
    );
    expect(facts.openings).toEqual([
      {
        arrangements: ['remote'],
        places: [{ kind: 'country', code: 'US' }],
        placeStrictness: 'label',
        timezones: [],
        arrangementSource: 'linkedin',
        placesSource: 'linkedin',
        confidence: 'sure',
        quote: expect.stringContaining('LinkedIn'),
      },
    ]);
    expect(facts.arrangement).toMatchObject({
      value: 'remote',
      source: 'linkedin',
      confidence: 'sure',
    });
    expect(conflicts).toEqual([]);
  });

  it('listing gives an unstated opening without a place when it has only an arrangement', () => {
    const { facts } = combine(
      doc({ arrangementValue: 'unstated', openings: [opening()] }),
      listing({ arrangement: 'remote' }),
    );
    expect(facts.openings).toMatchObject([
      {
        arrangements: ['remote'],
        places: [],
        placeStrictness: 'unstated',
        arrangementSource: 'linkedin',
        placesSource: 'linkedin',
      },
    ]);
  });

  it('listing supplies only the place when the description states the arrangement', () => {
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'remote',
        openings: [
          opening({
            arrangements: ['remote'],
            confidence: 'unsure',
            quote: 'remote-first',
          }),
        ],
      }),
      listing({
        arrangement: 'remote',
        place: { kind: 'country', code: 'US' },
      }),
    );
    expect(facts.openings).toEqual([
      {
        arrangements: ['remote'],
        places: [{ kind: 'country', code: 'US' }],
        placeStrictness: 'label',
        timezones: [],
        arrangementSource: 'description',
        placesSource: 'linkedin',
        confidence: 'unsure',
        quote: expect.stringContaining('remote-first'),
      },
    ]);
    expect(facts.arrangement).toMatchObject({
      value: 'remote',
      source: 'description',
    });
    expect(conflicts).toEqual([]);
  });

  it('keeps the description openings when the listing has no place', () => {
    const openings = [opening({ arrangements: ['remote'] })];
    const { facts } = combine(
      doc({ arrangementValue: 'remote', openings }),
      listing({ arrangement: 'remote' }),
    );
    expect(facts.openings).toMatchObject([
      {
        arrangements: ['remote'],
        places: [],
        arrangementSource: 'description',
        placesSource: 'description',
      },
    ]);
  });

  it('a description place elsewhere is a conflict, not a second opening', () => {
    const lyon = {
      kind: 'city' as const,
      name: 'Lyon',
      countryCode: 'FR',
      cityId: 'c-lyon',
    };
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'onsite',
        openings: [
          opening({
            arrangements: ['onsite'],
            places: [paris],
            placeStrictness: 'limit',
            quote: 'based in Paris',
          }),
        ],
      }),
      listing({ arrangement: 'onsite', place: lyon }),
    );
    expect(facts.openings).toHaveLength(1);
    expect(facts.openings[0]).toMatchObject({
      places: [
        { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: 'c-paris' },
      ],
      arrangementSource: 'description',
      placesSource: 'description',
    });
    expect(conflicts).toEqual([
      {
        field: 'places',
        listingValue: lyon,
        descriptionValue: [
          { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: 'c-paris' },
        ],
        quote: 'based in Paris',
        winner: 'description',
      },
    ]);
  });

  it('a description place inside the listing country is no conflict', () => {
    const { conflicts } = combine(
      doc({
        arrangementValue: 'onsite',
        openings: [
          opening({
            arrangements: ['onsite'],
            places: [paris],
            placeStrictness: 'limit',
          }),
        ],
      }),
      listing({
        arrangement: 'onsite',
        place: { kind: 'country', code: 'FR' },
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('a country inside a listing region, and a region sharing countries, is no conflict', () => {
    for (const place of [
      { kind: 'country' as const, code: 'FR' },
      { kind: 'worldwide' as const },
    ]) {
      const { conflicts } = combine(
        doc({
          arrangementValue: 'remote',
          openings: [
            opening({
              arrangements: ['remote'],
              places: [place],
              placeStrictness: 'limit',
            }),
          ],
        }),
        listing({ place: { kind: 'region', code: 'EU' } }),
      );
      expect(conflicts).toEqual([]);
    }
  });

  it('the listing place fills an opening that has only a time zone (Mo Works)', () => {
    const tz = { fromUtc: 8, toUtc: 11, label: 'Australia' };
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [opening({ timezones: [tz] })],
      }),
      listing({
        arrangement: 'onsite',
        place: { kind: 'country', code: 'EG' },
        locationText: 'Cairo, Egypt',
      }),
    );
    expect(facts.openings).toEqual([
      {
        arrangements: ['onsite'],
        places: [{ kind: 'country', code: 'EG' }],
        placeStrictness: 'label',
        timezones: [tz],
        quote: 'LinkedIn: Cairo, Egypt',
        confidence: 'sure',
        arrangementSource: 'linkedin',
        placesSource: 'linkedin',
      },
    ]);
    expect(conflicts.filter((c) => c.field === 'places')).toEqual([]);
  });

  it('the listing place fills a placeless opening beside a placed one (Nourish)', () => {
    const { facts } = combine(
      doc({
        arrangementValue: 'hybrid',
        openings: [
          opening({
            arrangements: ['hybrid'],
            places: [paris],
            placeStrictness: 'label',
            quote: 'hybrid out of Paris',
          }),
          opening({
            arrangements: ['remote'],
            quote: 'also welcomes remote candidacy',
          }),
        ],
      }),
      listing({
        arrangement: 'remote',
        place: { kind: 'country', code: 'US' },
        locationText: 'New York, NY',
      }),
    );
    expect(facts.openings).toMatchObject([
      {
        arrangements: ['hybrid'],
        places: [{ name: 'Paris' }],
        placesSource: 'description',
      },
      {
        arrangements: ['remote'],
        places: [{ kind: 'country', code: 'US' }],
        placeStrictness: 'label',
        placesSource: 'linkedin',
        quote: 'also welcomes remote candidacy | LinkedIn: New York, NY',
      },
    ]);
  });

  it('the listing place replaces a mentioned region on an office opening (01a207aa)', () => {
    const { facts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [
          opening({
            places: [{ kind: 'region', code: 'EMEA' }],
            placeStrictness: 'mention',
            quote: 'deliver managed solutions across EMEA',
          }),
        ],
      }),
      listing({
        arrangement: 'hybrid',
        place: { kind: 'country', code: 'DK' },
        locationText: 'Copenhagen, Denmark',
      }),
    );
    expect(facts.openings).toEqual([
      expect.objectContaining({
        arrangements: ['hybrid'],
        places: [{ kind: 'country', code: 'DK' }],
        placeStrictness: 'label',
        quote:
          'deliver managed solutions across EMEA | LinkedIn: Copenhagen, Denmark',
        arrangementSource: 'linkedin',
        placesSource: 'linkedin',
      }),
    ]);
  });

  it('a mentioned region stays on a remote opening, and a mentioned city stays on an office one', () => {
    const { facts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [
          opening({
            arrangements: ['remote'],
            places: [{ kind: 'region', code: 'EMEA' }],
            placeStrictness: 'mention',
          }),
          opening({
            arrangements: ['onsite'],
            places: [paris],
            placeStrictness: 'mention',
          }),
        ],
      }),
      listing({
        arrangement: 'hybrid',
        place: { kind: 'country', code: 'DK' },
        locationText: 'Copenhagen, Denmark',
      }),
    );
    expect(facts.openings).toMatchObject([
      {
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'mention',
        placesSource: 'description',
      },
      {
        places: [{ name: 'Paris' }],
        placeStrictness: 'mention',
        placesSource: 'description',
      },
    ]);
  });

  it('a time-zone-only opening stays placeless when the listing has no place', () => {
    const tz = { fromUtc: 0, toUtc: 2, label: 'European time zones' };
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'remote',
        openings: [opening({ arrangements: ['remote'], timezones: [tz] })],
      }),
      listing({ arrangement: 'remote' }),
    );
    expect(facts.openings).toMatchObject([
      { places: [], placeStrictness: 'unstated', placesSource: 'description' },
    ]);
    expect(conflicts.filter((c) => c.field === 'places')).toEqual([]);
  });

  it('an unstated opening with places takes the listing arrangement and keeps its places', () => {
    const { facts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [
          opening({
            places: [paris],
            placeStrictness: 'limit',
            quote: 'based in Paris',
            confidence: 'unsure',
          }),
          opening({
            arrangements: ['hybrid'],
            places: [paris],
            placeStrictness: 'label',
          }),
        ],
      }),
      listing({ arrangement: 'remote' }),
    );
    expect(facts.openings).toEqual([
      {
        arrangements: ['remote'],
        places: [{ ...paris, cityId: 'c-paris' }],
        placeStrictness: 'limit',
        timezones: [],
        quote: 'based in Paris',
        confidence: 'unsure',
        arrangementSource: 'linkedin',
        placesSource: 'description',
      },
      expect.objectContaining({
        arrangements: ['hybrid'],
        arrangementSource: 'description',
        placesSource: 'description',
      }),
    ]);
  });

  describe('place overlap', () => {
    const placesConflicts = (
      described: Opening['places'][number],
      listed: NonNullable<ListingFacts['place']>,
    ) =>
      combine(
        doc({
          arrangementValue: 'remote',
          openings: [
            opening({
              arrangements: ['remote'],
              places: [described],
              placeStrictness: 'limit',
            }),
          ],
        }),
        listing({ place: listed }),
      ).conflicts.filter((c) => c.field === 'places');

    it('regions overlap when they share a country, not when disjoint', () => {
      expect(
        placesConflicts(
          { kind: 'region', code: 'EMEA' },
          { kind: 'region', code: 'EU' },
        ),
      ).toEqual([]);
      expect(
        placesConflicts(
          { kind: 'region', code: 'NORTH_AMERICA' },
          { kind: 'region', code: 'EU' },
        ),
      ).toHaveLength(1);
    });

    it('a city with no id matches by country and folded name', () => {
      const listed = {
        kind: 'city' as const,
        name: 'Vélizy-Villacoublay',
        countryCode: 'FR',
        cityId: 'c-velizy',
      };
      expect(
        placesConflicts(
          {
            kind: 'city',
            name: 'velizy villacoublay',
            countryCode: 'FR',
            cityId: null,
          },
          listed,
        ),
      ).toEqual([]);
      expect(
        placesConflicts(
          { kind: 'city', name: 'Versailles', countryCode: 'FR', cityId: null },
          listed,
        ),
      ).toHaveLength(1);
      expect(
        placesConflicts(
          {
            kind: 'city',
            name: 'Vélizy-Villacoublay',
            countryCode: 'BE',
            cityId: null,
          },
          listed,
        ),
      ).toHaveLength(1);
    });

    it('a city with no country is not inside a country', () => {
      expect(
        placesConflicts(
          { kind: 'city', name: 'Paris', countryCode: null, cityId: null },
          { kind: 'country', code: 'FR' },
        ),
      ).toHaveLength(1);
    });
  });

  describe("the description's top-level arrangement", () => {
    const top = (
      value: string,
      confidence: 'sure' | 'unsure',
      quote: string,
    ): ExtractionDocument['arrangement'] => ({
      ...fixtureDocument().arrangement,
      value,
      confidence,
      quote,
    });

    it('fills unstated openings before the listing, and the listing disagreeing is a conflict', () => {
      const { facts, conflicts } = combine(
        doc({
          arrangement: top('hybrid', 'unsure', 'hybrid, 2 days a week'),
          openings: [opening()],
        }),
        listing({ arrangement: 'remote' }),
      );
      expect(facts.openings).toEqual([
        {
          arrangements: ['hybrid'],
          places: [],
          placeStrictness: 'unstated',
          timezones: [],
          quote: '',
          confidence: 'unsure',
          arrangementSource: 'description',
          placesSource: 'description',
        },
      ]);
      expect(facts.arrangement).toMatchObject({
        value: 'hybrid',
        source: 'description',
      });
      expect(conflicts).toEqual([
        {
          field: 'arrangement',
          listingValue: 'remote',
          descriptionValue: ['hybrid'],
          quote: 'hybrid, 2 days a week',
          winner: 'description',
        },
      ]);
    });

    it('is the arrangement of the listing-built opening, which keeps the listing place', () => {
      const { facts, conflicts } = combine(
        doc({
          arrangement: top('onsite', 'sure', 'in the office'),
          openings: [opening()],
        }),
        listing({
          arrangement: 'remote',
          place: { kind: 'country', code: 'US' },
          locationText: 'United States',
        }),
      );
      expect(facts.openings).toEqual([
        {
          arrangements: ['onsite'],
          places: [{ kind: 'country', code: 'US' }],
          placeStrictness: 'label',
          timezones: [],
          quote: expect.stringContaining('LinkedIn: United States'),
          confidence: 'sure',
          arrangementSource: 'description',
          placesSource: 'linkedin',
        },
      ]);
      expect(conflicts.map((c) => c.field)).toEqual(['arrangement']);
    });

    it('an opening that states its own arrangement keeps it', () => {
      const { facts } = combine(
        doc({
          arrangementValue: 'hybrid',
          openings: [
            opening({ arrangements: ['remote'] }),
            opening({ quote: 'other' }),
          ],
        }),
        listing({ arrangement: 'onsite' }),
      );
      expect(facts.openings.map((o) => o.arrangements)).toEqual([
        ['remote'],
        ['hybrid'],
      ]);
      expect(facts.openings.map((o) => o.arrangementSource)).toEqual([
        'description',
        'description',
      ]);
    });

    it("unstated at the top, the openings' stated arrangement is the arrangement, not the listing's", () => {
      const { facts } = combine(
        doc({
          arrangementValue: 'unstated',
          openings: [
            opening({
              arrangements: ['remote'],
              confidence: 'unsure',
              quote: 'fully remote',
            }),
            opening({ arrangements: ['remote'], quote: 'remote in EU' }),
          ],
        }),
        listing({ arrangement: 'onsite' }),
      );
      expect(facts.arrangement).toEqual({
        value: 'remote',
        source: 'description',
        confidence: 'unsure',
        quote: 'fully remote | remote in EU',
      });
    });

    it('unstated at the top, openings stating several arrangements leave it unstated, from the description', () => {
      const { facts } = combine(
        doc({
          arrangementValue: 'unstated',
          openings: [
            opening({ arrangements: ['remote'], quote: 'remote in EU' }),
            opening({ arrangements: ['onsite'], quote: 'onsite in Paris' }),
          ],
        }),
        listing({ arrangement: 'onsite' }),
      );
      expect(facts.arrangement).toEqual({
        value: 'unstated',
        source: 'description',
        confidence: 'sure',
        quote: 'remote in EU | onsite in Paris',
      });
    });
  });

  it('unstated at the top, openings stating several arrangements with one unsure leave it unstated, least sure', () => {
    const { facts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [
          opening({ arrangements: ['remote'], quote: 'remote in EU' }),
          opening({
            arrangements: ['hybrid'],
            confidence: 'unsure',
            quote: 'hybrid in Paris',
          }),
        ],
      }),
      listing({ arrangement: 'onsite' }),
    );
    expect(facts.arrangement).toEqual({
      value: 'unstated',
      source: 'description',
      confidence: 'unsure',
      quote: 'remote in EU | hybrid in Paris',
    });
  });

  it('carries engagement and contract months from the description, for display', () => {
    const base = doc();
    const d = doc({
      engagement: { ...base.engagement, value: 'contractor', quote: 'B2B' },
      contractMonths: {
        ...base.contractMonths,
        value: 6,
        quote: '6-month contract',
      },
    });
    const { facts } = combine(d, listing());
    expect(facts.engagement).toEqual({
      value: 'contractor',
      confidence: d.engagement.confidence,
      source: 'description',
      quote: 'B2B',
    });
    expect(facts.contractMonths).toEqual({
      value: 6,
      confidence: d.contractMonths.confidence,
      source: 'description',
      quote: '6-month contract',
    });
    expect(jobFactsDocumentSchema.parse(facts)).toEqual(facts);
  });

  it('seniority is never filled from the listing', () => {
    const base = doc();
    const { facts, conflicts } = combine(
      doc({ seniority: { ...base.seniority, value: 'unstated' } }),
      listing({ experienceLevel: 'Mid-Senior level' }),
    );
    expect(facts.seniority).toMatchObject({
      value: 'unstated',
      source: 'description',
    });
    expect(conflicts).toEqual([]);
  });

  it('seniority junior against Mid-Senior level is a conflict, senior is not', () => {
    const base = doc();
    const junior = combine(
      doc({
        seniority: { ...base.seniority, value: 'junior', quote: 'junior dev' },
      }),
      listing({ experienceLevel: 'Mid-Senior level' }),
    );
    expect(junior.facts.seniority.value).toBe('junior');
    expect(junior.conflicts).toEqual([
      {
        field: 'seniority',
        listingValue: 'Mid-Senior level',
        descriptionValue: 'junior',
        quote: 'junior dev',
        winner: 'description',
      },
    ]);
    const senior = combine(
      doc({ seniority: { ...base.seniority, value: 'senior' } }),
      listing({ experienceLevel: 'Mid-Senior level' }),
    );
    expect(senior.conflicts).toEqual([]);
    const noEvidence = combine(
      doc({ seniority: { ...base.seniority, value: 'junior' } }),
      listing({ experienceLevel: 'Not Applicable' }),
    );
    expect(noEvidence.conflicts).toEqual([]);
  });

  it('contract type is never filled from the listing, but contract against Full-time is a conflict', () => {
    const base = doc();
    const unstated = combine(
      doc({ contractType: { ...base.contractType, value: null } }),
      listing({ contractText: 'Full-time' }),
    );
    expect(unstated.facts.contractType).toMatchObject({
      value: null,
      source: 'description',
    });
    expect(unstated.conflicts).toEqual([]);

    const contract = combine(
      doc({
        contractType: {
          ...base.contractType,
          value: 'contract',
          quote: '6-month contract',
        },
      }),
      listing({ contractText: 'Full-time' }),
    );
    expect(contract.facts.contractType.value).toBe('contract');
    expect(contract.conflicts).toEqual([
      {
        field: 'contractType',
        listingValue: 'Full-time',
        descriptionValue: 'contract',
        quote: '6-month contract',
        winner: 'description',
      },
    ]);
    const same = combine(
      doc({ contractType: { ...base.contractType, value: 'full_time' } }),
      listing({ contractText: 'Full-time' }),
    );
    expect(same.conflicts).toEqual([]);
  });

  it('salary: listing fills a null description salary; both stated and not overlapping is a conflict', () => {
    const base = doc();
    const listed = {
      min: 5000,
      max: 7000,
      currency: 'EUR',
      period: 'month' as const,
    };

    const filled = combine(
      doc({ salary: { ...base.salary, value: null } }),
      listing({ salary: listed }),
    );
    expect(filled.facts.salary).toMatchObject({
      value: listed,
      source: 'linkedin',
      confidence: 'sure',
    });
    expect(filled.conflicts).toEqual([]);

    const apart = combine(
      doc({
        salary: {
          ...base.salary,
          value: { min: 8000, max: 9000, currency: 'EUR', period: 'month' },
          quote: '8-9k a month',
        },
      }),
      listing({ salary: listed }),
    );
    expect(apart.facts.salary).toMatchObject({
      value: { min: 8000, max: 9000, currency: 'EUR', period: 'month' },
      source: 'description',
    });
    expect(apart.conflicts).toEqual([
      {
        field: 'salary',
        listingValue: listed,
        descriptionValue: {
          min: 8000,
          max: 9000,
          currency: 'EUR',
          period: 'month',
        },
        quote: '8-9k a month',
        winner: 'description',
      },
    ]);

    const otherCurrency = combine(
      doc({
        salary: {
          ...base.salary,
          value: { min: 5000, max: 7000, currency: 'USD', period: 'month' },
        },
      }),
      listing({ salary: listed }),
    );
    expect(otherCurrency.conflicts.map((c) => c.field)).toEqual(['salary']);

    const overlapping = combine(
      doc({
        salary: {
          ...base.salary,
          value: { min: 6000, max: null, currency: 'EUR', period: 'month' },
        },
      }),
      listing({ salary: listed }),
    );
    expect(overlapping.conflicts).toEqual([]);

    const otherPeriod = combine(
      doc({
        salary: {
          ...base.salary,
          value: { min: 80000, max: 90000, currency: 'EUR', period: 'year' },
        },
      }),
      listing({ salary: listed }),
    );
    expect(otherPeriod.conflicts).toEqual([]);
  });

  it('closed when expiresAt is before now', () => {
    const d = doc();
    expect(
      combine(d, listing({ expiresAt: new Date('2026-11-11T00:00:00Z') })).facts
        .closed,
    ).toBe(true);
    expect(combine(d, listing({ expiresAt: NOW })).facts.closed).toBe(true);
    expect(
      combine(d, listing({ expiresAt: new Date('2026-11-13T00:00:00Z') })).facts
        .closed,
    ).toBe(false);
    expect(combine(d, listing()).facts.closed).toBe(false);
  });

  it('detects the posting languages from the description text', () => {
    const text = [
      'We are looking for a senior backend engineer to join our payments team. You will design and build the services that move money between our customers and their banks.',
      'You have at least five years of experience with Go or Python, and you enjoy working closely with product managers and designers.',
    ].join('\n\n');
    const withText = combineFacts({
      extraction: doc(),
      listing: listing(),
      vocab,
      now: NOW,
      extractedAt: NOW,
      descriptionText: text,
    }).facts;
    expect(withText.postingLanguages).toEqual({
      codes: ['en'],
      closeCalls: [],
      confident: true,
    });
    expect(jobFactsDocumentSchema.safeParse(withText).success).toBe(true);
    // Facts stored before closeCalls existed still parse.
    const { codes, confident } = withText.postingLanguages;
    const old = { ...withText, postingLanguages: { codes, confident } };
    const parsed = jobFactsDocumentSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.postingLanguages.closeCalls).toEqual([]);
    expect(combine(doc(), listing()).facts.postingLanguages).toEqual({
      codes: [],
      closeCalls: [],
      confident: false,
    });
  });

  it('copies the other matcher facts from the description', () => {
    const d = doc();
    const { facts } = combine(d, listing());
    expect(facts.version).toBe(8);
    for (const key of [
      'position',
      'isSoftwareEngineeringRole',
      'yearsRequired',
      'requiredLanguages',
      'workAuthorization',
      'techStack',
    ] as const) {
      expect(facts[key]).toEqual({
        value: d[key].value,
        confidence: d[key].confidence,
        source: 'description',
        quote: d[key].quote,
      });
    }
  });

  it('derives a work permit from no sponsorship and the listing place', () => {
    const d = doc({
      workAuthorization: {
        ...fixtureDocument().workAuthorization,
        value: { requirements: [], sponsorship: 'no' },
        quote: 'no sponsorship available',
        confidence: 'sure',
      },
      openings: [
        opening({
          timezones: [{ fromUtc: -8, toUtc: -5, label: 'US time zones' }],
        }),
      ],
    });
    const { facts } = combine(
      d,
      listing({ place: { kind: 'country', code: 'US' } }),
    );
    expect(facts.workAuthorization).toEqual({
      value: {
        requirements: [
          { kind: 'work-permit', place: 'US', derived: 'no-sponsorship' },
        ],
        sponsorship: 'no',
      },
      quote: 'no sponsorship available',
      confidence: 'sure',
      source: 'description',
    });
    expect(jobFactsDocumentSchema.parse(facts)).toEqual(facts);
  });

  it('parses requirements with no derived key', () => {
    const { facts } = combine(
      doc({
        workAuthorization: {
          ...fixtureDocument().workAuthorization,
          value: {
            requirements: [{ kind: 'citizenship', place: 'US' }],
            sponsorship: 'no',
          },
          quote: 'q',
          confidence: 'sure',
        },
      }),
      listing(),
    );
    expect(jobFactsDocumentSchema.parse(facts)).toEqual(facts);
  });

  it('the result parses with jobFactsDocumentSchema', () => {
    const cases = [
      combine(doc(), listing()),
      combine(
        doc({ arrangementValue: 'unstated', openings: [opening()] }),
        listing({
          arrangement: 'remote',
          place: { kind: 'country', code: 'US' },
          salary: { min: 1, max: 2, currency: null, period: 'hour' },
          expiresAt: NOW,
        }),
      ),
    ];
    for (const { facts } of cases) {
      expect(jobFactsDocumentSchema.parse(facts)).toEqual(facts);
    }
    const bad = { ...cases[0].facts, extra: 1 };
    expect(jobFactsDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('limitsBindPerson is set from the extraction time, from the cut-over on', () => {
    const at = (ms: number) =>
      combine(doc(), listing(), new Date(ms)).facts.limitsBindPerson;
    const since = LIMITS_BIND_PERSON_SINCE.getTime();
    expect(LIMITS_BIND_PERSON_SINCE.toISOString()).toBe(
      '2026-11-20T14:50:00.000Z',
    );
    expect(at(since - 1000)).toBe(false);
    expect(at(since)).toBe(true);
  });

  it('facts stored before limitsBindPerson existed parse as from before the cut-over', () => {
    const { facts } = combine(doc(), listing(), LIMITS_BIND_PERSON_SINCE);
    const old: Partial<typeof facts> = { ...facts };
    delete old.limitsBindPerson;
    const parsed = jobFactsDocumentSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.limitsBindPerson).toBe(false);
  });
});
