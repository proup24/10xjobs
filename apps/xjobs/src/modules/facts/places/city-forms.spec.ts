import { cityForms, placeCityKey, type CityFormRow } from './city-forms';

const row = (p: Partial<CityFormRow> & { id: string }): CityFormRow => ({
  name: 'X',
  aliases: [],
  countryCode: 'MA',
  status: 'approved',
  firstSeenAt: new Date('2026-01-01'),
  ...p,
});

const at = (forms: Map<string, string>, name: string, cc = 'MA') =>
  forms.get(placeCityKey(cc, name));

describe('cityForms', () => {
  it('maps names and aliases by folded spelling', () => {
    const forms = cityForms([row({ id: 'a', name: 'Fès', aliases: ['Fez'] })]);
    expect(at(forms, 'FES')).toBe('a');
    expect(at(forms, 'fez')).toBe('a');
  });

  it('lets a canonical name beat another city alias, even an older one', () => {
    const forms = cityForms([
      row({
        id: 'old',
        name: 'Other',
        aliases: ['Fes'],
        firstSeenAt: new Date('2020-01-01'),
      }),
      row({ id: 'new', name: 'Fès' }),
    ]);
    expect(at(forms, 'Fes')).toBe('new');
  });

  it('lets an approved city beat an older proposed duplicate', () => {
    const forms = cityForms([
      row({
        id: 'p',
        name: 'Fes',
        status: 'proposed',
        firstSeenAt: new Date('2020-01-01'),
      }),
      row({ id: 'a', name: 'Fès' }),
    ]);
    expect(at(forms, 'Fes')).toBe('a');
  });

  it('breaks a tie by oldest first seen, then id', () => {
    const older = cityForms([
      row({ id: 'b', name: 'Fes', firstSeenAt: new Date('2025-01-01') }),
      row({
        id: 'a',
        name: 'Fès',
        aliases: [],
        firstSeenAt: new Date('2026-01-01'),
      }),
    ]);
    expect(at(older, 'Fes')).toBe('b');
    const byId = cityForms([
      row({ id: 'z', name: 'Fes' }),
      row({ id: 'a', name: 'Fès' }),
    ]);
    expect(at(byId, 'Fes')).toBe('a');
  });

  it('is independent of the row order', () => {
    const rows = [
      row({ id: 'p', name: 'Fes', status: 'proposed' }),
      row({ id: 'a', name: 'Fès', aliases: ['Fes'] }),
      row({ id: 'q', name: 'Other', aliases: ['Fes'] }),
    ];
    expect(at(cityForms(rows), 'fes')).toBe(
      at(cityForms([...rows].reverse()), 'fes'),
    );
  });

  it('skips a spelling that folds to nothing', () => {
    expect(cityForms([row({ id: 'a', name: '--' })]).size).toBe(0);
  });

  it('keeps countries apart', () => {
    const forms = cityForms([
      row({ id: 'a', name: 'Nice', countryCode: 'FR' }),
    ]);
    expect(at(forms, 'Nice', 'MA')).toBeUndefined();
    expect(at(forms, 'Nice', 'FR')).toBe('a');
  });
});
