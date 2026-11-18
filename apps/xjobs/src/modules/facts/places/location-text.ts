import { foldPlaceName } from './fold';
import type { PlaceVocabulary } from './resolver';

/** The 50 US states and DC, as LinkedIn writes them after a city (`Austin, TX`). */
export const US_STATE_CODES: ReadonlySet<string> = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO ' +
    'MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'
  ).split(' '),
);

export interface ParsedLocation {
  countryCode: string | null;
  city: string | null;
  /** True when the text said something, whether or not it was readable. */
  named: boolean;
}

/**
 * Read a LinkedIn location text (`City, Region, Country`, `Region, Country`,
 * `Country`, `City, ST`, `Greater City Area`) into a country and a city.
 * Anything unreadable gives nulls with `named` true.
 */
export function parseLocationText(
  text: string,
  vocab: PlaceVocabulary,
): ParsedLocation {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0)
    return { countryCode: null, city: null, named: false };
  const unreadable = { countryCode: null, city: null, named: true };

  const last = parts[parts.length - 1];
  const country = vocab.countryNames.get(foldPlaceName(last));
  if (country) {
    return {
      countryCode: country,
      city: parts.length >= 3 ? parts[0] : null,
      named: true,
    };
  }
  if (parts.length === 2 && US_STATE_CODES.has(last.toUpperCase())) {
    return { countryCode: 'US', city: parts[0], named: true };
  }
  if (parts.length === 1) {
    const city = last
      .replace(/^Greater\s+/i, '')
      .replace(/(\s+Metropolitan)?\s+Area$/i, '')
      .trim();
    const countries = vocab.cityCountries.get(foldPlaceName(city));
    if (city && countries?.size === 1) {
      return { countryCode: [...countries][0], city, named: true };
    }
  }
  return unreadable;
}
