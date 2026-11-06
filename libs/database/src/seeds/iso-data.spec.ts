import { ISO_CURRENCIES, ISO_LANGUAGES } from './iso-data';

describe('ISO reference data', () => {
  it('lists ISO 639-1 codes, lowercase, unique', () => {
    const codes = ISO_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[a-z]{2}$/.test(c))).toBe(true);
    expect(codes).toEqual(
      expect.arrayContaining(['ar', 'fr', 'en', 'es', 'de']),
    );
    expect(ISO_LANGUAGES.every((l) => l.label.length > 0)).toBe(true);
  });

  it('lists ISO 4217 codes, uppercase, unique', () => {
    const codes = ISO_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(['USD', 'EUR', 'MAD', 'GBP']));
    expect(ISO_CURRENCIES.every((c) => c.label.length > 0)).toBe(true);
  });
});
