import {
  Arrangement,
  Channel,
  Position,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import { locationKey } from '../steps/normalize';
import type { QuerySearchCombination } from '../types';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash, toRecipe } from './recipe';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: Position.backend_engineer,
  location: 'casablanca, morocco',
  experience: Seniority.senior,
  type: Arrangement.onsite,
  technologies: [Technology.nestjs, Technology.typescript],
  domain: SkillDomain.backend,
};

describe('recipe', () => {
  it('is deterministic and a sha-256 hex digest', () => {
    const hash = toRecipe(base).hash;
    expect(hash).toBe(toRecipe(structuredClone(base)).hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, Partial<QuerySearchCombination>]>([
    ['channel', { channel: Channel.LINKEDIN_POSTS }],
    ['location', { location: 'rabat, morocco' }],
    ['experience', { experience: Seniority.staff }],
    ['type', { type: Arrangement.hybrid }],
    ['domain', { domain: SkillDomain.fullstack }],
    [
      'technology order',
      { technologies: [Technology.typescript, Technology.nestjs] },
    ],
  ])('changes the hash when %s changes', (_name, change) => {
    expect(toRecipe({ ...base, ...change }).hash).not.toBe(toRecipe(base).hash);
  });

  it('hashes two spellings of one location alike', () => {
    expect(
      toRecipe({ ...base, location: locationKey('Paris,  France') }).hash,
    ).toBe(toRecipe({ ...base, location: locationKey('paris, france') }).hash);
  });

  it('hashes one location apart across arrangements', () => {
    expect(toRecipe({ ...base, type: Arrangement.hybrid }).hash).not.toBe(
      toRecipe({ ...base, type: Arrangement.onsite }).hash,
    );
  });

  it('is at recipe version 6', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(6);
    expect(toRecipe(base).version).toBe(6);
  });

  it('keeps boolean operators uppercase in the stored keyword', () => {
    expect(toRecipe(base).keyword).toContain(' OR ');
  });

  it('ignores params key order', () => {
    const rest = { ...toRecipe(base), hash: undefined, position: undefined };
    expect(recipeHash({ ...rest, params: { a: 1, b: { d: 1, c: 2 } } })).toBe(
      recipeHash({ ...rest, params: { b: { c: 2, d: 1 }, a: 1 } }),
    );
  });

  it('has the version and stores the trimmed channel keyword', () => {
    const recipe = toRecipe(base);
    expect(recipe.version).toBe(QUERY_SEARCH_RECIPE_VERSION);
    expect(recipe.keyword).toBe(recipe.keyword.trim());
    expect(recipe.keyword).not.toContain('senior');
  });

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v6).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      '29b439fd695213fd706dabdec3ed4b52157f3a46e60f62e98f9900524bc787a2',
    ],
    [
      Channel.LINKEDIN_POSTS,
      'cde1367966e288ddb5750e6be7abd58ec8414f2ae9686b8879b9f82e869e60cf',
    ],
    [
      Channel.GREEN_HOUSE,
      'd3c539738f7bb0b389b1227d34b3f8bb15e7190c79a1a1c8e6f6137517ab7bb1',
    ],
    [
      Channel.ASHBY,
      'a5585e37e719d462f98e8b54c0aa80d21af6d8d4a4c239923757fdf24af5c9ba',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
