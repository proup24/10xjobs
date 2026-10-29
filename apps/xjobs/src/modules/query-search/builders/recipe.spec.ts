import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
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
    [
      'technology order',
      { technologies: [Technology.typescript, Technology.nestjs] },
    ],
  ])('changes the hash when %s changes', (_name, change) => {
    expect(toRecipe({ ...base, ...change }).hash).not.toBe(toRecipe(base).hash);
  });

  it('ignores params key order', () => {
    const rest = { ...toRecipe(base), hash: undefined, position: undefined };
    expect(recipeHash({ ...rest, params: { a: 1, b: { d: 1, c: 2 } } })).toBe(
      recipeHash({ ...rest, params: { b: { c: 2, d: 1 }, a: 1 } }),
    );
  });

  it('has the version and sorted keywords', () => {
    const recipe = toRecipe(base);
    expect(recipe.version).toBe(QUERY_SEARCH_RECIPE_VERSION);
    expect(recipe.keywords).toEqual([...recipe.keywords].sort());
  });

  // Rows are deduplicated by hash forever: these digests must never change.
  it.each<[Channel, string]>([
    [Channel.LINKEDIN_JOB_BOARD, 'TBD'],
    [Channel.LINKEDIN_POSTS, 'TBD'],
    [Channel.GREEN_HOUSE, 'TBD'],
    [Channel.ASHBY, 'TBD'],
  ])('pins the %s hash', (channel, digest) => {
    console.log('H', channel, toRecipe({ ...base, channel }).hash);
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
