import { Seniority } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import {
  displayLocation,
  locationKey,
  normalizeLocations,
  normalizeProfile,
} from './normalize';

const empty = { remote: [], hybrid: [], onsite: [] };
const input: QuerySearchProfileInput = {
  position: 'backend_engineer',
  seniorities: [Seniority.senior],
  locations: { ...empty, remote: ['EMEA'] },
  skills: [],
};

describe('displayLocation', () => {
  it('trims and collapses inner whitespace, keeping case', () => {
    expect(displayLocation('  Paris,   France ')).toBe('Paris, France');
  });
});

describe('locationKey', () => {
  it('is the display form lowercased', () => {
    expect(locationKey(' Paris,  FRANCE')).toBe('paris, france');
  });
});

describe('normalizeLocations', () => {
  it('dedupes by key within a list, keeping the first spelling', () => {
    expect(
      normalizeLocations({
        ...empty,
        remote: ['Europe', 'europe ', 'Morocco'],
      }),
    ).toEqual({ ...empty, remote: ['Europe', 'Morocco'] });
  });

  it('keeps the same location in two arrangements', () => {
    expect(
      normalizeLocations({ ...empty, hybrid: ['France'], onsite: ['france'] }),
    ).toEqual({ ...empty, hybrid: ['France'], onsite: ['france'] });
  });

  it('does not mutate its input', () => {
    const remote = ['Europe', 'europe'];
    normalizeLocations({ ...empty, remote });
    expect(remote).toEqual(['Europe', 'europe']);
  });
});

describe('normalizeProfile', () => {
  it('normalizes the locations', () => {
    expect(
      normalizeProfile({
        ...input,
        locations: { ...empty, onsite: [' Rabat ,  Morocco'] },
      }).locations,
    ).toEqual({ ...empty, onsite: ['Rabat , Morocco'] });
  });

  it('dedupes the seniorities in enum order', () => {
    expect(
      normalizeProfile({
        ...input,
        seniorities: [Seniority.staff, Seniority.senior, Seniority.staff],
      }).seniorities,
    ).toEqual([Seniority.senior, Seniority.staff]);
  });

  it('adds no default location when every list is empty', () => {
    expect(normalizeProfile({ ...input, locations: empty }).locations).toEqual(
      empty,
    );
  });
});
