import { cityNameKey } from './city-key';
import { SEED } from './seed-data';
import { SEED_CITIES } from './seed-cities';

describe('SEED_CITIES', () => {
  it("every city's country is a seeded country", () => {
    const codes = new Set(SEED.countries.map((c) => c.code));
    for (const city of SEED_CITIES) {
      expect(
        codes.has(city.countryCode),
        `${city.name} ${city.countryCode}`,
      ).toBe(true);
    }
  });

  it('no city is listed twice', () => {
    const keys = SEED_CITIES.map(
      (c) => `${c.countryCode}|${cityNameKey(c.name)}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names are trimmed and non-empty', () => {
    for (const city of SEED_CITIES) {
      expect(
        city.name === city.name.trim() && city.name.length > 0,
        city.name,
      ).toBe(true);
    }
  });
});
