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

  it('is at recipe version 5', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(5);
    expect(toRecipe(base).version).toBe(5);
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
      '18be6979e7aea5f271ed4f9ca578baac1ee18cda9fc36f962c527ceb244637fd',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '2b70eee7a6878ac1e1b70927ffcfbf2301030d43495d671d0637ae2455117930',
    ],
    [
      Channel.GREEN_HOUSE,
      'e9b80ec0e1f6911eb1ba0ae0e47df21abe18d0a1b77d7ca531abc6953037bd66',
    ],
    [
      Channel.ASHBY,
      '7f7096e4a98bd9cbe30cda31246541017acf3ec2142a026b6b0939d627200e13',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
