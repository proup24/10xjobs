import { Arrangement, Channel, Seniority, SkillDomain } from 'src/common/enums';
import { locationKey } from '../steps/normalize';
import type { QuerySearchCombination } from '../types';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash, toRecipe } from './recipe';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: 'backend_engineer',
  location: 'casablanca, morocco',
  experience: 'senior',
  type: Arrangement.onsite,
  technologies: ['nestjs', 'typescript'],
  domain: SkillDomain.backend,
  languages: ['en'],
};

describe('recipe', () => {
  it('is deterministic and a sha-256 hex digest', () => {
    const hash = toRecipe(base).hash;
    expect(hash).toBe(toRecipe(structuredClone(base)).hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, Partial<QuerySearchCombination>]>([
    ['channel', { channel: Channel.ASHBY }],
    ['location', { location: 'rabat, morocco' }],
    ['experience', { experience: Seniority.staff }],
    ['type', { type: Arrangement.hybrid }],
    ['domain', { domain: SkillDomain.fullstack }],
    ['technology order', { technologies: ['typescript', 'nestjs'] }],
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

  it('is at recipe version 15', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(15);
    expect(toRecipe(base).version).toBe(15);
  });

  it('keeps boolean operators uppercase in the stored keyword', () => {
    expect(toRecipe({ ...base, channel: Channel.ASHBY }).keyword).toContain(
      ' OR ',
    );
  });

  it('does not build a post recipe', () => {
    expect(() =>
      toRecipe({ ...base, channel: Channel.LINKEDIN_POSTS }),
    ).toThrow('Post recipes are built by postRecipes');
  });

  it('ignores params key order', () => {
    const rest = { ...toRecipe(base), hash: undefined, position: undefined };
    expect(recipeHash({ ...rest, params: { a: 1, b: { d: 1, c: 2 } } })).toBe(
      recipeHash({ ...rest, params: { b: { c: 2, d: 1 }, a: 1 } }),
    );
  });

  it('hashes the LinkedIn role words, so languages change the hash', () => {
    expect(toRecipe({ ...base, languages: ['en', 'fr'] }).hash).not.toBe(
      toRecipe(base).hash,
    );
  });

  it('has the version and stores the trimmed channel keyword', () => {
    const recipe = toRecipe(base);
    expect(recipe.version).toBe(QUERY_SEARCH_RECIPE_VERSION);
    expect(recipe.keyword).toBe(recipe.keyword.trim());
    expect(recipe.keyword).not.toContain('senior');
  });

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v15).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'ca36d5db2e68b2571c903a788067ac0124ba08269da394a2179b02fec40d0c1b',
    ],
    [
      Channel.GREEN_HOUSE,
      'd225b529a725e184b2f98bfb9d1d350be34865f67bf9c622fc5bd184fb5e2629',
    ],
    [
      Channel.ASHBY,
      '5fe28522f2496ff8b84781fe989ecbf0e62166736dd3e12d3431d17fb66a6f2e',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
