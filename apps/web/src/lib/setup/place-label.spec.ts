import { describe, expect, it } from 'vitest';
import { placeLabeler } from './place-label';

const CITY = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';
const label = placeLabeler({
  regions: [{ value: 'EU', label: 'Europe' }],
  countries: [{ value: 'DE', label: 'Germany' }],
  cities: [{ value: CITY.toUpperCase(), label: 'Berlin, Germany' }],
});

describe('placeLabeler', () => {
  it('labels each kind of place', () => {
    expect(label({ kind: 'region', code: 'EU' })).toBe('Europe');
    expect(label({ kind: 'country', code: 'DE' })).toBe('Germany');
    expect(label({ kind: 'city', id: CITY })).toBe('Berlin, Germany');
  });

  it('never shows a raw code', () => {
    expect(label({ kind: 'country', code: 'XX' })).toBe('Unknown');
  });
});
