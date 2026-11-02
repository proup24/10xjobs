import {
  ACTIVE_CHANNELS,
  Arrangement,
  Position,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import { toRecipe } from '../builders';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { dedupeByHash, locationCombinations } from './combinations';

const profile: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  seniority: Seniority.senior,
  locations: { remote: ['Europe'], hybrid: ['France'], onsite: ['France'] },
  skills: [],
};
const sets = [
  { technologies: [Technology.nestjs], domain: SkillDomain.backend },
  { technologies: [Technology.typescript], domain: SkillDomain.fullstack },
];
const channels = ACTIVE_CHANNELS.length;

describe('locationCombinations', () => {
  it('expands arrangement x active channel x location x technology set', () => {
    expect(locationCombinations(profile, sets)).toHaveLength(3 * channels * 2);
  });

  it('carries the location key and its arrangement', () => {
    const combinations = locationCombinations(profile, sets);
    const pairs = new Set(combinations.map((c) => `${c.type}|${c.location}`));
    expect([...pairs]).toEqual([
      `${Arrangement.remote}|europe`,
      `${Arrangement.hybrid}|france`,
      `${Arrangement.onsite}|france`,
    ]);
  });

  it('has no region, country or city', () => {
    for (const combination of locationCombinations(profile, sets)) {
      expect(combination).not.toHaveProperty('locationRegion');
      expect(combination).not.toHaveProperty('country');
      expect(combination).not.toHaveProperty('city');
    }
  });

  it('orders arrangement, then channel, then location, then set', () => {
    const [first, second] = locationCombinations(profile, sets);
    expect(first).toMatchObject({
      type: Arrangement.remote,
      channel: ACTIVE_CHANNELS[0],
      location: 'europe',
      technologies: [Technology.nestjs],
      domain: SkillDomain.backend,
      experience: Seniority.senior,
    });
    expect(second).toMatchObject({
      location: 'europe',
      technologies: [Technology.typescript],
      domain: SkillDomain.fullstack,
    });
  });

  it('builds no combination for an inactive channel', () => {
    const built = new Set(
      locationCombinations(profile, sets).map((c) => c.channel),
    );
    expect([...built]).toEqual([...ACTIVE_CHANNELS]);
  });

  it('skips an arrangement with no locations', () => {
    const combinations = locationCombinations(
      { ...profile, locations: { remote: [], hybrid: [], onsite: ['Rabat'] } },
      sets,
    );
    expect(combinations).toHaveLength(channels * 2);
    expect(combinations.every((c) => c.type === Arrangement.onsite)).toBe(true);
  });
});

describe('dedupeByHash', () => {
  it('keeps the first of each hash, in order', () => {
    const [a, b] = locationCombinations(profile, sets)
      .slice(0, 2)
      .map(toRecipe) as [QuerySearchRecipe, QuerySearchRecipe];
    const copy = { ...a };
    expect(dedupeByHash([a, b, copy])).toEqual([a, b]);
    expect(dedupeByHash([a, b, copy])[0]).toBe(a);
  });
});
