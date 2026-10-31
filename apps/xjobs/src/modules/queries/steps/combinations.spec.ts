import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import { toRecipe } from '../builders';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import {
  dedupeByHash,
  localCombinations,
  remoteCombinations,
} from './combinations';

const profile: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  regions: [Region.EMEA, Region.MENA],
  arrangements: [Arrangement.remote, Arrangement.onsite],
  seniority: Seniority.senior,
  country: 'MA',
  city: 'Casablanca',
  skills: [],
};
const sets = [[Technology.nestjs], [Technology.typescript]];
const remoteAndOnsite = [Arrangement.remote, Arrangement.onsite];

describe('remoteCombinations', () => {
  it('expands channel x region x technology set', () => {
    const combinations = remoteCombinations(profile, remoteAndOnsite, sets);
    expect(combinations).toHaveLength(16);
    expect(combinations.every((c) => c.type === Arrangement.remote)).toBe(true);
    expect(combinations.every((c) => c.country === null && c.city === null)).toBe(
      true,
    );
    expect(combinations.every((c) => c.experience === Seniority.senior)).toBe(
      true,
    );
  });

  it('orders channel, then region, then set', () => {
    const [first, second, third] = remoteCombinations(
      profile,
      remoteAndOnsite,
      sets,
    );
    expect(first).toMatchObject({
      channel: Object.values(Channel)[0],
      locationRegion: Region.EMEA,
      technologies: [Technology.nestjs],
    });
    expect(second).toMatchObject({
      locationRegion: Region.EMEA,
      technologies: [Technology.typescript],
    });
    expect(third).toMatchObject({ locationRegion: Region.MENA });
  });

  it('is empty without remote', () => {
    expect(remoteCombinations(profile, [Arrangement.onsite], sets)).toEqual([]);
  });
});

describe('localCombinations', () => {
  it('expands channel x technology set in the city, with no region', () => {
    const combinations = localCombinations(profile, remoteAndOnsite, sets);
    expect(combinations).toHaveLength(8);
    for (const combination of combinations) {
      expect(combination).toMatchObject({
        type: Arrangement.onsite,
        locationRegion: null,
        country: 'MA',
        city: 'Casablanca',
      });
    }
  });

  it('expands onsite and hybrid separately', () => {
    const combinations = localCombinations(
      profile,
      [Arrangement.onsite, Arrangement.hybrid],
      sets,
    );
    expect(combinations).toHaveLength(16);
    expect(combinations.filter((c) => c.type === Arrangement.hybrid)).toHaveLength(
      8,
    );
  });

  it('is empty for remote only', () => {
    expect(localCombinations(profile, [Arrangement.remote], sets)).toEqual([]);
  });
});

describe('dedupeByHash', () => {
  it('keeps the first of each hash, in order', () => {
    const [a, b] = remoteCombinations(profile, [Arrangement.remote], sets)
      .slice(0, 2)
      .map(toRecipe) as [QuerySearchRecipe, QuerySearchRecipe];
    const copy = { ...a };
    expect(dedupeByHash([a, b, copy])).toEqual([a, b]);
    expect(dedupeByHash([a, b, copy])[0]).toBe(a);
  });
});
