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

  it('is at recipe version 10', () => {
    expect(QUERY_SEARCH_RECIPE_VERSION).toBe(10);
    expect(toRecipe(base).version).toBe(10);
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

  // Rows are deduplicated by hash forever: these digests change only with QUERY_SEARCH_RECIPE_VERSION (v10).
  it.each<[Channel, string]>([
    [
      Channel.LINKEDIN_JOB_BOARD,
      '8f277c0f5fd3da838c213317656900227cc6601a3d800a3678bb034ffa1ae736',
    ],
    [
      Channel.LINKEDIN_POSTS,
      '37c6591648dafe59d7de63c534947f47d35a8bdb42411474bdb640d32c613bea',
    ],
    [
      Channel.GREEN_HOUSE,
      'df54b288f9698c48ced25837dce8f247e6ab1e4cab37c83c9116c5f9ff8125cc',
    ],
    [
      Channel.ASHBY,
      '74d918680eece79f2082ad489ac3e1404412bf68ecbad5b63c65468355842cbf',
    ],
  ])('pins the %s hash', (channel, digest) => {
    expect(toRecipe({ ...base, channel }).hash).toBe(digest);
  });
});
