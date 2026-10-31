import {
  Arrangement,
  Position,
  Region,
  Seniority,
} from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import { normalizeArrangements, normalizeProfile } from './normalize';

const input: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  regions: [Region.EMEA],
  arrangements: [Arrangement.remote],
  seniority: Seniority.senior,
  country: 'MA',
  city: 'Casablanca',
  skills: [],
};

describe('normalizeProfile', () => {
  it('trims and uppercases the country', () => {
    expect(normalizeProfile({ ...input, country: ' ma ' }).country).toBe('MA');
  });

  it('trims the city', () => {
    expect(normalizeProfile({ ...input, city: '  Casablanca ' }).city).toBe(
      'Casablanca',
    );
  });

  it('turns a blank city into null', () => {
    expect(normalizeProfile({ ...input, city: '   ' }).city).toBeNull();
  });

  it('dedupes regions in first-seen order', () => {
    expect(
      normalizeProfile({
        ...input,
        regions: [Region.EMEA, Region.EMEA, Region.MENA],
      }).regions,
    ).toEqual([Region.EMEA, Region.MENA]);
  });

  it('defaults empty regions to GLOBAL', () => {
    expect(normalizeProfile({ ...input, regions: [] }).regions).toEqual([
      Region.GLOBAL,
    ]);
  });

  it('does not mutate its input', () => {
    const regions = [Region.EMEA, Region.EMEA];
    normalizeProfile({ ...input, regions });
    expect(regions).toEqual([Region.EMEA, Region.EMEA]);
  });
});

describe('normalizeArrangements', () => {
  it('treats unstated as remote', () => {
    expect(normalizeArrangements([Arrangement.unstated])).toEqual([
      Arrangement.remote,
    ]);
  });

  it('treats an empty list as remote', () => {
    expect(normalizeArrangements([])).toEqual([Arrangement.remote]);
  });

  it('treats unstated as remote next to other arrangements, deduped', () => {
    expect(
      normalizeArrangements([
        Arrangement.onsite,
        Arrangement.unstated,
        Arrangement.remote,
      ]),
    ).toEqual([Arrangement.onsite, Arrangement.remote]);
  });

  it('keeps hybrid as is', () => {
    expect(normalizeArrangements([Arrangement.hybrid])).toEqual([
      Arrangement.hybrid,
    ]);
  });
});
