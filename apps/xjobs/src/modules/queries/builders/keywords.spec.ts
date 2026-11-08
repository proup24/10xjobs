import { ENGINEERING_ROLE_KINDS, SEED } from '@xjobs/database';
import { Seniority } from 'src/common/enums';
import {
  ARRANGEMENT_WORDS,
  POSITION_TITLES,
  SENIORITY_WORDS,
  TECHNOLOGY_TERMS,
} from './keywords';
import { LINKEDIN_TERMS } from '../channels/linkedin_board.builder';

describe('keywords', () => {
  // The maps are keyed by plain codes: a mistyped key would silently drop a
  // technology or position from every search, so each key must be a seed code.
  const seedCodes = (list: 'techTags' | 'roleKinds') =>
    new Set(SEED[list].map((term) => term.code));

  it.each([
    ['TECHNOLOGY_TERMS', TECHNOLOGY_TERMS],
    ['LINKEDIN_TERMS', LINKEDIN_TERMS],
  ])('keys %s by seeded tech_tags codes', (_name, terms) => {
    const codes = seedCodes('techTags');
    expect(Object.keys(terms).filter((key) => !codes.has(key))).toEqual([]);
  });

  it('keys POSITION_TITLES by seeded role_kinds codes', () => {
    const codes = seedCodes('roleKinds');
    expect(
      Object.keys(POSITION_TITLES).filter((key) => !codes.has(key)),
    ).toEqual([]);
  });

  it('maps every position to normalized phrases', () => {
    for (const position of ENGINEERING_ROLE_KINDS) {
      const titles = POSITION_TITLES[position];
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(titles.length).toBeLessThanOrEqual(3);
      for (const title of titles) {
        expect(title).not.toBe('');
        expect(title).toBe(title.toLowerCase().trim());
      }
    }
  });

  it('puts the canonical title first and keeps common aliases', () => {
    expect(POSITION_TITLES.backend_engineer).toContain('backend engineer');
    expect(POSITION_TITLES.backend_engineer[0]).toBe('backend engineer');
    expect(POSITION_TITLES.site_reliability_engineer).toContain('sre');
  });

  it('maps every technology to a non-empty term', () => {
    for (const technology of Object.keys(TECHNOLOGY_TERMS)) {
      expect(TECHNOLOGY_TERMS[technology]).toBeTruthy();
    }
    expect(TECHNOLOGY_TERMS.nodejs).toBe('node.js');
    expect(TECHNOLOGY_TERMS.csharp).toBe('c#');
    expect(TECHNOLOGY_TERMS.react_native).toBe('react native');
    expect(TECHNOLOGY_TERMS.github_actions).toBe('github actions');
  });

  it('maps seniority and arrangement words', () => {
    for (const seniority of Object.values(Seniority)) {
      expect(SENIORITY_WORDS).toHaveProperty(seniority);
    }
    expect(SENIORITY_WORDS.unstated).toBeNull();
    expect(SENIORITY_WORDS.senior).toBe('senior');
    expect(ARRANGEMENT_WORDS.onsite).toBe('on-site');
    expect(ARRANGEMENT_WORDS.remote).toBe('remote');
    expect(ARRANGEMENT_WORDS.unstated).toBeNull();
  });
});
