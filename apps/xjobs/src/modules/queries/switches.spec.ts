import { Channel, SkillDomain } from 'src/common/enums';
import type { QuerySearchProfileInput } from './types';
import { indeedRecipes } from './indeed';
import { SEARCH_SWITCHES, switchFlags, switchesInEffect } from './switches';

const input: QuerySearchProfileInput = {
  position: 'backend_engineer',
  seniorities: ['senior'],
  languages: ['en'],
  locations: { remote: ['EMEA'], hybrid: [], onsite: [] },
  skills: [
    {
      technology: 'nestjs',
      domain: SkillDomain.backend,
      importance: 9,
      mastery: 8,
    },
  ],
};

const byKey = (key: string) => SEARCH_SWITCHES.find((sw) => sw.key === key)!;

describe('search switches', () => {
  it('lists posts and indeed, both unavailable', () => {
    expect(
      SEARCH_SWITCHES.map(({ key, column, channel, available }) => ({
        key,
        column,
        channel,
        available,
      })),
    ).toEqual([
      {
        key: 'posts',
        column: 'postSearch',
        channel: Channel.LINKEDIN_POSTS,
        available: false,
      },
      {
        key: 'indeed',
        column: 'indeedSearch',
        channel: Channel.INDEED,
        available: false,
      },
    ]);
  });

  it('in effect when the flag is on, available or not', () => {
    expect(
      switchesInEffect({ postSearch: true, indeedSearch: false }).map(
        (sw) => sw.key,
      ),
    ).toEqual(['posts']);
    expect(
      switchesInEffect({ postSearch: true, indeedSearch: true }).map(
        (sw) => sw.key,
      ),
    ).toEqual(['posts', 'indeed']);
    expect(
      switchesInEffect({ postSearch: false, indeedSearch: false }),
    ).toEqual([]);
  });

  it('reads in effect from the given registry', () => {
    const registry = [{ ...byKey('indeed'), available: true }];
    expect(
      switchesInEffect({ postSearch: true, indeedSearch: false }, registry),
    ).toEqual([]);
  });

  it("the indeed switch is INDEED's and stays unavailable", () => {
    const sw = byKey('indeed');
    expect(sw.channel).toBe(Channel.INDEED);
    expect(sw.available).toBe(false);
    expect(sw.recipes).toBe(indeedRecipes);
    // No market rows or places on this input: nothing to search.
    expect(sw.recipes(input)).toEqual([]);
  });

  it('posts adds the post recipes', () => {
    const recipes = byKey('posts').recipes(input);
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes.every((r) => r.channel === Channel.LINKEDIN_POSTS)).toBe(
      true,
    );
  });

  it('switchFlags reads every switch column of a row', () => {
    expect(switchFlags({ postSearch: true, indeedSearch: false })).toEqual({
      postSearch: true,
      indeedSearch: false,
    });
  });
});
