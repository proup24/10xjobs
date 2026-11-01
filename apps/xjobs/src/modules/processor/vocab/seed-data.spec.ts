import {
  Arrangement,
  Engagement,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import { SEED, SEED_REGION_COUNTRIES, SEED_TECH_EXTRAS } from './seed-data';
import { LIST_NAMES } from './lists';

const codes = (list: keyof typeof SEED) => SEED[list].map((t) => t.code);

describe('processor seed data', () => {
  it.each([
    ['arrangements', Arrangement],
    ['seniorities', Seniority],
    ['roleKinds', Position],
    ['engagements', Engagement],
    ['regions', Region],
    ['techTags', Technology],
  ] as const)('every contract enum code is a seed code (%s)', (list, enm) => {
    for (const value of Object.values(enm)) {
      expect(codes(list)).toContain(value);
    }
  });

  it('role kinds and engagements have unstated; role kinds have other', () => {
    expect(codes('roleKinds')).toEqual(
      expect.arrayContaining(['unstated', 'other']),
    );
    expect(codes('engagements')).toContain('unstated');
  });

  it('countries are all 249 ISO alpha-2 codes, plus XK for Kosovo', () => {
    const all = codes('countries');
    expect(all.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(all.filter((c) => c !== 'XK')).toHaveLength(249);
    expect(all).toHaveLength(250);
  });

  it('region_countries reference seeded regions and countries', () => {
    const regions = new Set(codes('regions'));
    const countries = new Set(codes('countries'));
    for (const [region, country] of SEED_REGION_COUNTRIES) {
      expect(regions.has(region)).toBe(true);
      expect(countries.has(country)).toBe(true);
    }
  });

  it('tech extras reference seeded tech tags', () => {
    const tags = new Set(codes('techTags'));
    for (const [code, extra] of Object.entries(SEED_TECH_EXTRAS)) {
      expect(tags.has(code)).toBe(true);
      for (const implied of extra.implies) expect(tags.has(implied)).toBe(true);
    }
  });

  it.each(LIST_NAMES)('no duplicate codes or aliases within %s', (list) => {
    const lowerCodes = codes(list).map((c) => c.toLowerCase());
    expect(new Set(codes(list)).size).toBe(codes(list).length);
    const aliases = SEED[list].flatMap((t) => t.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) {
      expect(alias).toBe(alias.toLowerCase());
      expect(lowerCodes).not.toContain(alias);
    }
  });

  it('GLOBAL has no region_countries rows', () => {
    expect(SEED_REGION_COUNTRIES.filter(([r]) => r === 'GLOBAL')).toEqual([]);
  });
});
