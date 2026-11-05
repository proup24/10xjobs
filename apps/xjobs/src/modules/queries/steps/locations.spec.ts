import { BadRequestException } from '@nestjs/common';
import { MOCK_PROFILES } from '../testing/profiles.fixture';
import {
  assertHasLocations,
  hasLocation,
  LOCATIONS_REQUIRED,
} from './locations';

describe('hasLocation', () => {
  it('is false when every list is empty', () => {
    expect(hasLocation({ remote: [], hybrid: [], onsite: [] })).toBe(false);
  });

  it('is true when only onsite has a location', () => {
    expect(
      hasLocation({ remote: [], hybrid: [], onsite: ['Casablanca, Morocco'] }),
    ).toBe(true);
  });
});

describe('assertHasLocations', () => {
  it('rejects a profile with no location, saying why', () => {
    expect(() => assertHasLocations(MOCK_PROFILES.noLocations)).toThrow(
      new BadRequestException(LOCATIONS_REQUIRED),
    );
  });

  it('accepts a profile with one location', () => {
    expect(() =>
      assertHasLocations(MOCK_PROFILES.onsiteOnlyCasablanca),
    ).not.toThrow();
  });

  it('says exactly what is missing', () => {
    expect(LOCATIONS_REQUIRED).toBe(
      'locations must list at least one place in remote, hybrid or onsite',
    );
  });
});
