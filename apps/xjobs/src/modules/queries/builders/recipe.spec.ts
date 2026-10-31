import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import type { QuerySearchCombination } from '../types';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash, toRecipe } from './recipe';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: Position.backend_engineer,
  locationRegion: Region.EMEA,
  country: 'MA',
  city: 'Casablanca',
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
    ['region', { locationRegion: Region.EU }],
    ['country', { country: 'FR' }],
    ['city', { city: 'Rabat' }],
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

  it('hashes a null region apart from a real one', () => {
    expect(toRecipe({ ...base, locationRegion: null }).hash).not.toBe(
      toRecipe(base).hash,
    );
  });

  it('is at recipe version 4', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(4);
    expect(toRecipe(base).version).toBe(4);
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v4).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      '33d9940682e4c075f93b236447265b66a9c2e3b8476cc1146eda1e6c8957bccd',
    ],
    [
      Channel.LINKEDIN_POSTS,
      'b09095ed3be8be2dca6f4b22edae5837aac67e3cea0a3d820acdc22f050cfec1',
    ],
    [
      Channel.GREEN_HOUSE,
      '386bd32aca55aa6a8c6348b12663f04ee58b27634e089b64cf074ad3d86b3a1e',
    ],
    [
      Channel.ASHBY,
      '5387499a016f672cf97a9a2c88819866f4bc9eec664af5b3ddc38697e283dcd1',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
