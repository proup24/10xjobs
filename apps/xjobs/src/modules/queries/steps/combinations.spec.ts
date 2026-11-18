import {
  ACTIVE_CHANNELS,
  Arrangement,
  Channel,
  Seniority,
  SkillDomain,
} from 'src/common/enums';
import { toRecipe } from '../builders';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import {
  dedupeByHash,
  dedupeBySearch,
  locationCombinations,
} from './combinations';

// Cover every channel's expansion, inactive ones included.
vi.mock('src/common/enums', async (importOriginal) => {
  const enums = await importOriginal<typeof import('src/common/enums')>();
  return {
    ...enums,
    ACTIVE_CHANNELS: Object.values(enums.Channel).filter(
      (channel) => !enums.isTrialChannel(channel),
    ),
  };
});

const profile: QuerySearchProfileInput = {
  position: 'backend_engineer',
  seniorities: [Seniority.senior],
  locations: { remote: ['Europe'], hybrid: ['France'], onsite: ['France'] },
  skills: [],
  languages: ['en'],
};
const sets = [
  { technologies: ['nestjs'], domain: SkillDomain.backend },
  { technologies: ['typescript'], domain: SkillDomain.fullstack },
];
/** Technology sets over all active channels: the LinkedIn job board has one set, the others one per technology. */
const setTotal = ACTIVE_CHANNELS.reduce(
  (total, channel) =>
    total + (channel === Channel.LINKEDIN_JOB_BOARD ? 1 : sets.length),
  0,
);
const others = (combinations: ReturnType<typeof locationCombinations>) =>
  combinations.filter((c) => c.channel !== Channel.LINKEDIN_JOB_BOARD);

describe('locationCombinations', () => {
  it('expands arrangement x active channel x location x technology set', () => {
    expect(locationCombinations(profile, sets)).toHaveLength(3 * setTotal);
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
    const [first, second] = others(locationCombinations(profile, sets));
    expect(first).toMatchObject({
      type: Arrangement.remote,
      channel: ACTIVE_CHANNELS.find((c) => c !== Channel.LINKEDIN_JOB_BOARD),
      location: 'europe',
      technologies: ['nestjs'],
      domain: SkillDomain.backend,
      experience: Seniority.senior,
    });
    expect(second).toMatchObject({
      location: 'europe',
      technologies: ['typescript'],
      domain: SkillDomain.fullstack,
    });
  });

  it('builds no combination for an inactive channel', () => {
    const built = new Set(
      locationCombinations(profile, sets).map((c) => c.channel),
    );
    expect([...built]).toEqual([...ACTIVE_CHANNELS]);
  });

  it('expands one combination per seniority', () => {
    const both = others(
      locationCombinations(
        { ...profile, seniorities: [Seniority.senior, Seniority.staff] },
        sets,
      ),
    );
    const otherChannels = ACTIVE_CHANNELS.filter(
      (c) => c !== Channel.LINKEDIN_JOB_BOARD,
    ).length;
    expect(both).toHaveLength(3 * otherChannels * 2 * 2);
    const tuple = (c: (typeof both)[number]) =>
      [c.type, c.channel, c.location, c.technologies.join(',')].join('|');
    const byTuple = new Map<string, string[]>();
    for (const c of both)
      byTuple.set(tuple(c), [...(byTuple.get(tuple(c)) ?? []), c.experience]);
    expect(byTuple.size).toBe(3 * otherChannels * 2);
    for (const levels of byTuple.values())
      expect(levels).toEqual([Seniority.senior, Seniority.staff]);
  });

  it('puts seniority innermost, after the technology set', () => {
    const [first, second] = others(
      locationCombinations(
        { ...profile, seniorities: [Seniority.senior, Seniority.staff] },
        sets,
      ),
    );
    expect(first?.experience).toBe(Seniority.senior);
    expect(second?.experience).toBe(Seniority.staff);
    expect(second?.technologies).toEqual(first?.technologies);
  });

  it('skips an arrangement with no locations', () => {
    const combinations = locationCombinations(
      { ...profile, locations: { remote: [], hybrid: [], onsite: ['Rabat'] } },
      sets,
    );
    expect(combinations).toHaveLength(setTotal);
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

describe('LinkedIn job board combinations', () => {
  const emea: QuerySearchProfileInput = {
    ...profile,
    languages: ['en'],
    seniorities: [Seniority.mid, Seniority.senior],
    locations: { remote: ['EMEA'], hybrid: [], onsite: [] },
  };
  const board = (input: QuerySearchProfileInput) =>
    locationCombinations(input, sets).filter(
      (c) => c.channel === Channel.LINKEDIN_JOB_BOARD,
    );

  it('expands each search place and each single level', () => {
    const combos = board(emea);
    expect(
      new Set(combos.map((c) => `${c.location}|${c.experienceLevel}`)),
    ).toEqual(
      new Set(
        ['africa', 'europe', 'middle east'].flatMap((place) => [
          `${place}|3`,
          `${place}|4`,
        ]),
      ),
    );
    expect(combos.every((c) => c.technologies.length === 2)).toBe(true);
  });

  it('gives 6 distinct recipes after dedupeBySearch', () => {
    const recipes = board(emea).map(toRecipe);
    expect(dedupeBySearch(dedupeByHash(recipes))).toHaveLength(6);
  });

  it('keeps one combination without a level for an unstated seniority', () => {
    const combos = board({
      ...emea,
      seniorities: [Seniority.unstated],
      locations: { remote: ['Spain'], hybrid: [], onsite: [] },
    });
    expect(combos).toHaveLength(1);
    expect(combos[0].experienceLevel).toBeUndefined();
  });

  it('carries the languages', () => {
    expect(board({ ...emea, languages: ['fr'] })[0].languages).toEqual(['fr']);
  });
});
