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

  it('is at recipe version 11', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(11);
    expect(toRecipe(base).version).toBe(11);
  });

  it('keeps boolean operators uppercase in the stored keyword', () => {
    expect(
      toRecipe({ ...base, channel: Channel.LINKEDIN_POSTS }).keyword,
    ).toContain(' OR ');
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v11).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'c244cb49c7cefb3a5bf79febfa74c3e5378f983104d9f87d55a2aa31c98d2bc8',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '1e72caa80404d09b205fc109e253551ccfad59d176263aeaa5ac7d5b48a4318f',
    ],
    [
      Channel.GREEN_HOUSE,
      '7790262f8b5bd48b24d2f461a609329386a76334784f98a4ad808bfd2248adf4',
    ],
    [
      Channel.ASHBY,
      '4c82a97977fc1ffcc7615f4b67c3a10e033437410a8a37ffc12b92c9c7492409',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
