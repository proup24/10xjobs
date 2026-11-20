import type { Fact } from '../../processor/schema/fact';
import type {
  ExtractionDocument,
  Opening,
  Place,
} from '../../processor/schema/extraction';
import { FACTS_VERSION } from '../config/facts.config';
import {
  EXPERIENCE_LEVEL_SENIORITY,
  LINKEDIN_CONTRACT_TYPES,
  LINKEDIN_NO_EVIDENCE,
} from '../config/linkedin-codes';
import { foldPlaceName } from '../places/fold';
import { findCity, type PlaceVocabulary } from '../places/resolver';
import type {
  FactOpening,
  FactSalary,
  JobFactsDocument,
  SourcedFact,
} from '../schema/facts';
import { cleanCurrency } from './currency';
import type { ListingFacts } from './listing';
import { deriveFromNoSponsorship } from './no-sponsorship';
import { detectPostingLanguages } from './posting-language';

export interface FactConflict {
  field: 'arrangement' | 'places' | 'salary' | 'seniority' | 'contractType';
  listingValue: unknown;
  descriptionValue: unknown;
  quote: string;
  winner: 'description' | 'listing';
}

const UNSTATED = 'unstated';

function fromDescription<T>(fact: Fact<T>): SourcedFact<T> {
  return {
    value: fact.value,
    confidence: fact.confidence,
    source: 'description',
    quote: fact.quote,
  };
}

/** A description place with its city id looked up; never creates a city. */
function resolvePlace(place: Place, vocab: PlaceVocabulary): Place {
  if (place.kind !== 'city') return place;
  const cityId =
    place.countryCode === null
      ? null
      : findCity(place.name, place.countryCode, vocab);
  return { ...place, cityId };
}

function descriptionOpening(o: Opening, vocab: PlaceVocabulary): FactOpening {
  return {
    arrangements: o.arrangements,
    places: o.places.map((p) => resolvePlace(p, vocab)),
    placeStrictness: o.placeStrictness,
    timezones: o.timezones,
    quote: o.quote,
    confidence: o.confidence,
    arrangementSource: 'description',
    placesSource: 'description',
  };
}

/** Whether `outer` contains `inner` (or equals it), by the place hierarchy. */
function contains(outer: Place, inner: Place, vocab: PlaceVocabulary): boolean {
  if (outer.kind === 'worldwide') return true;
  if (outer.kind === 'region') {
    const countries = vocab.regionCountries.get(outer.code);
    if (inner.kind === 'region') {
      if (inner.code === outer.code) return true;
      const others = vocab.regionCountries.get(inner.code);
      return (
        !!countries && !!others && [...others].some((c) => countries.has(c))
      );
    }
    if (inner.kind === 'country') return !!countries?.has(inner.code);
    if (inner.kind === 'city')
      return inner.countryCode !== null && !!countries?.has(inner.countryCode);
    return false;
  }
  if (outer.kind === 'country') {
    if (inner.kind === 'country') return inner.code === outer.code;
    if (inner.kind === 'city') return inner.countryCode === outer.code;
    return false;
  }
  if (inner.kind !== 'city') return false;
  if (outer.cityId !== null && inner.cityId !== null)
    return outer.cityId === inner.cityId;
  return (
    outer.countryCode === inner.countryCode &&
    foldPlaceName(outer.name) === foldPlaceName(inner.name)
  );
}

function overlaps(a: Place, b: Place, vocab: PlaceVocabulary): boolean {
  return contains(a, b, vocab) || contains(b, a, vocab);
}

/** "LinkedIn: remote, Paris, France": the quote of a fact taken from the listing. */
function listingQuote(...parts: (string | null)[]): string {
  const said = parts.filter((p): p is string => !!p);
  return said.length ? `LinkedIn: ${said.join(', ')}` : 'LinkedIn listing';
}

/** The description's top-level arrangement, when it states one. */
function statedArrangement(
  extraction: ExtractionDocument,
): Fact<string> | null {
  const top = extraction.arrangement;
  return top.value !== null && top.value !== UNSTATED ? top : null;
}

/** The less certain of two confidences. */
const leastSure = (
  a: FactOpening['confidence'],
  b: FactOpening['confidence'],
): FactOpening['confidence'] =>
  a === 'unsure' || b === 'unsure' ? 'unsure' : 'sure';

/**
 * The openings: the description's, or one built from the listing (spec "The listing opening").
 * An arrangement comes from the opening, else the description's top-level arrangement, else
 * the listing's; each opening records the source of its arrangement and of its places.
 */
function combineOpenings(
  described: FactOpening[],
  listing: ListingFacts,
  top: Fact<string> | null,
): FactOpening[] {
  const silent = described.every(
    (o) => o.places.length === 0 && o.timezones.length === 0,
  );
  const stated = described.some((o) =>
    o.arrangements.some((a) => a !== UNSTATED),
  );
  const place = listing.place;
  // The listing opening is built only when the listing gives it something: a place, or an
  // arrangement the description does not state anywhere.
  const listed =
    place !== null || (top === null && listing.arrangement !== null);
  if (silent && listed && !stated) {
    return [
      {
        arrangements: [top?.value ?? listing.arrangement ?? UNSTATED],
        places: place ? [place] : [],
        placeStrictness: place ? 'label' : 'unstated',
        timezones: [],
        quote: top
          ? [top.quote, listingQuote(listing.locationText)]
              .filter(Boolean)
              .join(' | ')
          : listingQuote(listing.arrangement, listing.locationText),
        confidence: top?.confidence ?? 'sure',
        arrangementSource: top ? 'description' : 'linkedin',
        placesSource: 'linkedin',
      },
    ];
  }
  // The listing supplies only the place, to each opening with none; the description's
  // arrangement, confidence and time zones stand.
  const placed: FactOpening[] =
    place !== null
      ? described.map((o) =>
          o.places.length > 0
            ? o
            : {
                ...o,
                places: [place],
                placeStrictness: 'label',
                quote: [o.quote, listingQuote(listing.locationText)]
                  .filter(Boolean)
                  .join(' | '),
                placesSource: 'linkedin',
              },
        )
      : described;
  return placed.map((o) => fillArrangement(o, top, listing.arrangement));
}

/**
 * An opening whose arrangement is only `unstated` takes the description's top-level
 * arrangement (with that fact's confidence), else the listing's (sure).
 */
function fillArrangement(
  o: FactOpening,
  top: Fact<string> | null,
  listed: string | null,
): FactOpening {
  if (o.arrangements.some((a) => a !== UNSTATED)) return o;
  if (top?.value)
    return {
      ...o,
      arrangements: [top.value],
      confidence: leastSure(o.confidence, top.confidence),
      arrangementSource: 'description',
    };
  if (listed === null) return o;
  return { ...o, arrangements: [listed], arrangementSource: 'linkedin' };
}

/**
 * The job's arrangement: the description's top-level one; else the one its openings state
 * (with the least sure of their confidences, and their quotes; `unstated` when they state
 * several, so the openings speak for themselves); else the listing's.
 */
function combineArrangement(
  extraction: ExtractionDocument,
  listing: ListingFacts,
): SourcedFact<string> {
  const described = extraction.arrangement;
  if (described.value !== null && described.value !== UNSTATED)
    return fromDescription(described);
  const stating = extraction.openings.filter((o) =>
    o.arrangements.some((a) => a !== UNSTATED),
  );
  if (stating.length > 0) {
    const stated = [
      ...new Set(
        stating.flatMap((o) => o.arrangements.filter((a) => a !== UNSTATED)),
      ),
    ];
    return {
      value: stated.length === 1 ? stated[0] : UNSTATED,
      confidence: stating
        .map((o) => o.confidence)
        .reduce<FactOpening['confidence']>(leastSure, 'sure'),
      source: 'description',
      quote: stating
        .map((o) => o.quote)
        .filter(Boolean)
        .join(' | '),
    };
  }
  if (listing.arrangement !== null)
    return {
      value: listing.arrangement,
      confidence: 'sure',
      source: 'linkedin',
      quote: listingQuote(listing.arrangement),
    };
  return { ...fromDescription(described), value: UNSTATED };
}

function arrangementConflict(
  extraction: ExtractionDocument,
  listing: ListingFacts,
): FactConflict | null {
  if (listing.arrangement === null) return null;
  const top = statedArrangement(extraction);
  const stating = extraction.openings.filter((o) =>
    o.arrangements.some((a) => a !== UNSTATED),
  );
  const stated = [
    ...new Set([
      ...stating.flatMap((o) => o.arrangements.filter((a) => a !== UNSTATED)),
      ...(top?.value ? [top.value] : []),
    ]),
  ];
  if (stated.length === 0 || stated.includes(listing.arrangement)) return null;
  const quotes = stating.map((o) => o.quote).filter(Boolean);
  return {
    field: 'arrangement',
    listingValue: listing.arrangement,
    descriptionValue: stated,
    // The openings' quotes; the top-level one when no opening has a quote of its own.
    quote: (quotes.length ? quotes : [top?.quote ?? '']).join(' | '),
    winner: 'description',
  };
}

function placesConflict(
  described: FactOpening[],
  listing: ListingFacts,
  vocab: PlaceVocabulary,
): FactConflict | null {
  const place = listing.place;
  const withPlaces = described.filter((o) => o.places.length > 0);
  const places = withPlaces.flatMap((o) => o.places);
  if (place === null || places.length === 0) return null;
  if (places.some((p) => overlaps(p, place, vocab))) return null;
  return {
    field: 'places',
    listingValue: place,
    descriptionValue: places,
    quote: withPlaces
      .map((o) => o.quote)
      .filter(Boolean)
      .join(' | '),
    winner: 'description',
  };
}

function cleanSalary(salary: FactSalary): FactSalary {
  return { ...salary, currency: cleanCurrency(salary.currency) };
}

function salariesDisagree(a: FactSalary, b: FactSalary): boolean {
  if (a.currency !== null && b.currency !== null && a.currency !== b.currency)
    return true;
  if (a.period !== b.period) return false;
  const aLo = a.min ?? a.max;
  const aHi = a.max ?? a.min;
  const bLo = b.min ?? b.max;
  const bHi = b.max ?? b.min;
  if (aLo === null || aHi === null || bLo === null || bHi === null)
    return false;
  return aLo > bHi || bLo > aHi;
}

function combineSalary(
  extraction: ExtractionDocument,
  listing: ListingFacts,
): { fact: SourcedFact<FactSalary>; conflict: FactConflict | null } {
  const described = extraction.salary;
  const listed = listing.salary ? cleanSalary(listing.salary) : null;
  if (described.value !== null) {
    const value = cleanSalary(described.value);
    return {
      fact: { ...fromDescription(described), value },
      conflict:
        listed && salariesDisagree(value, listed)
          ? {
              field: 'salary',
              listingValue: listed,
              descriptionValue: value,
              quote: described.quote,
              winner: 'description',
            }
          : null,
    };
  }
  if (listed)
    return {
      fact: {
        value: listed,
        confidence: 'sure',
        source: 'linkedin',
        quote: listingQuote('salary'),
      },
      conflict: null,
    };
  return {
    fact: { ...fromDescription(described), value: null },
    conflict: null,
  };
}

/** A description value outside the set LinkedIn's broad value allows. */
function codeConflict(
  field: 'seniority' | 'contractType',
  fact: Fact<string>,
  listingText: string | null,
  sets: Record<string, string[]>,
): FactConflict | null {
  const value = fact.value;
  if (value === null || value === UNSTATED || listingText === null) return null;
  const text = listingText.trim();
  if (LINKEDIN_NO_EVIDENCE.has(text)) return null;
  const allowed = Object.hasOwn(sets, text) ? sets[text] : undefined;
  if (!allowed || allowed.includes(value)) return null;
  return {
    field,
    listingValue: listingText,
    descriptionValue: value,
    quote: fact.quote,
    winner: 'description',
  };
}

/**
 * The facts the matcher reads: the description wins whenever it states a fact;
 * the listing fills only arrangement, place and salary, and sets `closed`.
 * Engagement and contract months are carried for display only. The posting's languages
 * are detected from `descriptionText` (null or short text is not confident).
 * Every disagreement is returned as a conflict.
 */
export function combineFacts(args: {
  extraction: ExtractionDocument;
  listing: ListingFacts;
  vocab: PlaceVocabulary;
  now: Date;
  descriptionText: string | null;
}): { facts: JobFactsDocument; conflicts: FactConflict[] } {
  const { extraction, listing, vocab, now, descriptionText } = args;
  const described = extraction.openings.map((o) =>
    descriptionOpening(o, vocab),
  );
  const salary = combineSalary(extraction, listing);

  const facts: JobFactsDocument = {
    version: FACTS_VERSION,
    position: fromDescription(extraction.position),
    isSoftwareEngineeringRole: fromDescription(
      extraction.isSoftwareEngineeringRole,
    ),
    seniority: fromDescription(extraction.seniority),
    yearsRequired: fromDescription(extraction.yearsRequired),
    contractType: fromDescription(extraction.contractType),
    engagement: fromDescription(extraction.engagement),
    contractMonths: fromDescription(extraction.contractMonths),
    requiredLanguages: fromDescription(extraction.requiredLanguages),
    workAuthorization: {
      ...fromDescription(extraction.workAuthorization),
      value: deriveFromNoSponsorship(
        extraction.workAuthorization.value,
        described,
        listing.place,
      ),
    },
    techStack: fromDescription(extraction.techStack),
    arrangement: combineArrangement(extraction, listing),
    openings: combineOpenings(
      described,
      listing,
      statedArrangement(extraction),
    ),
    salary: salary.fact,
    closed: listing.expiresAt !== null && listing.expiresAt <= now,
    postingLanguages: detectPostingLanguages(descriptionText ?? ''),
  };

  const conflicts = [
    arrangementConflict(extraction, listing),
    placesConflict(described, listing, vocab),
    salary.conflict,
    codeConflict(
      'seniority',
      extraction.seniority,
      listing.experienceLevel,
      EXPERIENCE_LEVEL_SENIORITY,
    ),
    codeConflict(
      'contractType',
      extraction.contractType,
      listing.contractText,
      LINKEDIN_CONTRACT_TYPES,
    ),
  ].filter((c): c is FactConflict => c !== null);

  return { facts, conflicts };
}
