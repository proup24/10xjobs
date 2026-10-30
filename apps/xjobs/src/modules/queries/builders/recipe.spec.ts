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

  it('has the version and stores one normalized keyword', () => {
    const recipe = toRecipe(base);
    expect(recipe.version).toBe(QUERY_SEARCH_RECIPE_VERSION);
    expect(recipe.keyword).toBe('senior backend engineer nestjs typescript');
  });

  // Rows are deduplicated by hash forever: these digests must never change.
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'c50265896c5b84b51ef1f8c62b8ef658afdccf211bbabdbbc5a17514899aa059',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '9b8c473481b5bbed5703a4dcc77502793d34ba1a9f29093fdd1a5fdb43139c31',
    ],
    [
      Channel.GREEN_HOUSE,
      'bcf157e25f4208ae162288ac2d52088d372a73619a25f70f243dfe2dc9dcea5f',
    ],
    [
      Channel.ASHBY,
      '22df481f53f396880cae8b3e96342d234678605a639b485112bff3ef08db6d42',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
