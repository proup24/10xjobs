import { SEED } from '@xjobs/database';
import { locationKey } from '../steps/normalize';
import { LINKEDIN_GEO_IDS } from './linkedin_geo';
import {
  LINKEDIN_SEARCH_MAP,
  SEARCH_MAP_CHECKED,
  searchPlaces,
} from './linkedin_search_map';

// Regions with no LinkedIn place to resolve to. APAC and Asia (excluding the
// GCC) need geoIds pinned by hand on linkedin.com (LINKEDIN_GEO_IDS has no
// Asian country yet); Global means no restriction.
const KNOWN_UNMAPPED = new Set([
  'Global',
  'Asia Pacific',
  'Asia (excluding the GCC)',
]);

describe('searchPlaces', () => {
  it('uses the map entry first', () => {
    expect(searchPlaces('EMEA')).toEqual(['africa', 'europe', 'middle east']);
    expect(searchPlaces('European Union')).toEqual(['europe']);
    expect(searchPlaces('GCC')).toEqual([
      'bahrain',
      'kuwait',
      'oman',
      'qatar',
      'saudi arabia',
      'united arab emirates',
    ]);
  });

  it('uses the key itself when it is pinned', () => {
    expect(searchPlaces('Morocco')).toEqual(['morocco']);
  });

  it('falls back to the country of "<city>, <country>"', () => {
    expect(searchPlaces('Casablanca, Morocco')).toEqual(['morocco']);
  });

  it('returns the key unchanged for an unknown place', () => {
    expect(searchPlaces('Atlantis')).toEqual(['atlantis']);
  });
});

describe('LINKEDIN_SEARCH_MAP', () => {
  it('has a check date', () => {
    expect(SEARCH_MAP_CHECKED).toBe('2026-11-14');
  });

  it('maps only to pinned LINKEDIN_GEO_IDS keys, under locationKey keys', () => {
    for (const [key, places] of Object.entries(LINKEDIN_SEARCH_MAP)) {
      expect(locationKey(key)).toBe(key);
      for (const place of places)
        expect(LINKEDIN_GEO_IDS).toHaveProperty([place]);
    }
  });

  it('pins Israel and Türkiye', () => {
    expect(LINKEDIN_GEO_IDS['israel']).toBe('101620260');
    expect(LINKEDIN_GEO_IDS['türkiye']).toBe('102105699');
    expect(LINKEDIN_GEO_IDS['turkey']).toBe('102105699');
  });

  it('resolves every seed region to a pinned place, except the known ones', () => {
    for (const { label } of SEED.regions) {
      const places = searchPlaces(label);
      if (KNOWN_UNMAPPED.has(label)) {
        expect(places.some((p) => p in LINKEDIN_GEO_IDS)).toBe(false);
        continue;
      }
      expect(places.length).toBeGreaterThan(0);
      for (const p of places) {
        expect(LINKEDIN_GEO_IDS, `${label} -> ${p}`).toHaveProperty([p]);
      }
    }
  });
});
