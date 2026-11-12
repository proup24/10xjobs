import type {
  ExtractionDocument,
  Opening,
} from '../../processor/schema/extraction';
import { fixtureDocument } from '../../processor/schema/fixture.testing';
import type { PlaceVocabulary } from '../places/resolver';
import { jobFactsDocumentSchema } from '../schema/facts';
import { combineFacts } from './combine';
import type { ListingFacts } from './listing';

const vocab: PlaceVocabulary = {
  regions: new Set(['EU']),
  countries: new Set(['FR', 'US']),
  cities: new Map([
    ['FR|paris', 'c-paris'],
    ['FR|lyon', 'c-lyon'],
  ]),
  cityNames: new Map([
    ['c-paris', 'Paris'],
    ['c-lyon', 'Lyon'],
  ]),
  regionCountries: new Map([['EU', new Set(['FR'])]]),
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

const combine = (extraction: ExtractionDocument, l: ListingFacts) =>
  combineFacts({ extraction, listing: l, vocab, now: NOW });

describe('combineFacts', () => {
  it('description arrangement wins and a disagreement is a conflict', () => {
    const { facts, conflicts } = combine(
      doc({
        arrangementValue: 'hybrid',
        openings: [opening({ arrangements: ['hybrid'] })],
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
        quote: 'hybrid quote',
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
        source: 'linkedin',
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
        source: 'linkedin',
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
        source: 'linkedin',
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
      { arrangements: ['remote'], places: [], source: 'description' },
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
      source: 'description',
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

  it('the listing opening is skipped when the description has a time zone', () => {
    const tz = { fromUtc: -5, toUtc: -3, label: 'Americas' };
    const { facts } = combine(
      doc({
        arrangementValue: 'unstated',
        openings: [opening({ timezones: [tz] })],
      }),
      listing({
        arrangement: 'remote',
        place: { kind: 'country', code: 'US' },
      }),
    );
    expect(facts.openings).toEqual([
      {
        arrangements: ['unstated'],
        places: [],
        placeStrictness: 'unstated',
        timezones: [tz],
        quote: '',
        confidence: 'sure',
        source: 'description',
      },
    ]);
    expect(facts.arrangement).toMatchObject({
      value: 'remote',
      source: 'linkedin',
    });
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

  it('copies the other matcher facts from the description', () => {
    const d = doc();
    const { facts } = combine(d, listing());
    expect(facts.version).toBe(1);
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
});
