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

  it('is at recipe version 12', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(12);
    expect(toRecipe(base).version).toBe(12);
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v12).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'cb3f5fae453e9c44c064ff990e23d0876b51b71e1053fd4083d73d73bbe18cb2',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '9eb5bdbd946897d8df1ac52c1d7aa226d4586a81f58e6d316342cb674523e8dd',
    ],
    [
      Channel.GREEN_HOUSE,
      'eb236419bffe83201b9902f83e4fc96050b00f70a0d90b77b9404c8094fb1434',
    ],
    [
      Channel.ASHBY,
      '6679f05f8a6cc1942efe8c70d591d0d3ee3b045314094ca7ebe443263c746422',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
