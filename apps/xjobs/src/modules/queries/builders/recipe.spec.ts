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

  it('is at recipe version 14', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(14);
    expect(toRecipe(base).version).toBe(14);
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v14).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'aaad6242e445cc1ae5625b972d5c85ca6bf089906ece900b4a7529b5dfa175fc',
    ],
    [
      Channel.GREEN_HOUSE,
      '116d4f8c59a4da8769a59ce8549abcfeb07dbc21a2bacc83fd9e8cf5f344e211',
    ],
    [
      Channel.ASHBY,
      '03023e22fd7f6b711e3cba440833e80b78cd6bb777e2337b1c3bc3355660f79b',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
