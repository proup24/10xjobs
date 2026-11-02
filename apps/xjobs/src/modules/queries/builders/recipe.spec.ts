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

  it('is at recipe version 9', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(9);
    expect(toRecipe(base).version).toBe(9);
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v7).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      'a048ee96eeb61a5eefa8d97d20863f2a57231f619cf0c2a754878ddfd0af175b',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '9e4ac24ba0e8c7992078a4feaf9dab2c0f1ec91e080780fa22f724c0238860c0',
    ],
    [
      Channel.GREEN_HOUSE,
      '47781cc465836c2ddace5f37cdf2af3fc876c377d7dfcb68b9fd899f8d212346',
    ],
    [
      Channel.ASHBY,
      'fc9faced2a430fbc798e610a2e5603735d07f48dee4327225886a36495017fac',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
