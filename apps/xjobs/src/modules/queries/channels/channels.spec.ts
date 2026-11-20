import { ENGINEERING_ROLE_KINDS } from '@xjobs/database';
import { Arrangement, Channel, Seniority, SkillDomain } from 'src/common/enums';
import { locationKey } from '../steps/normalize';
import type { QuerySearchCombination } from '../types';
import { TECHNOLOGY_TERMS } from '../builders/keywords';
import { AshbyQueryBuilder } from './ashbyhq.builder';
import { GreenhouseQueryBuilder } from './greenhouse.builder';
import { toRecipe } from '../builders/recipe';
import { CHANNEL_QUERY_BUILDERS } from '.';
import { isWorldwide, LINKEDIN_GEO_IDS } from './linkedin_geo';
import { roleWords } from '../builders/role-words';
import { linkedinLevels } from './linkedin_board.builder';
import { linkedinKeyword } from './linkedin_keyword';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: 'backend_engineer',
  location: 'emea',
  experience: 'senior',
  type: Arrangement.remote,
  technologies: ['nestjs', 'typescript'],
  domain: SkillDomain.backend,
  languages: ['en'],
};

const build = (
  channel: Channel,
  overrides: Partial<QuerySearchCombination> = {},
) => CHANNEL_QUERY_BUILDERS[channel].build({ ...base, channel, ...overrides });

const TITLES =
  '("backend engineer" OR "backend developer" OR "backend software engineer")';
const onsite = { type: Arrangement.onsite, location: 'casablanca, morocco' };

describe('LinkedIn job board builder', () => {
  const ROLES = roleWords('backend_engineer', ['en']);
  const board = (overrides: Partial<QuerySearchCombination> = {}) =>
    build(Channel.LINKEDIN_JOB_BOARD, { experienceLevel: '4', ...overrides });

  it('searches role words AND spellings, seniority only as f_E', () => {
    const query = board();
    expect(query.keyword).toBe(
      linkedinKeyword(ROLES, ['nest.js', 'nestjs', 'typescript']),
    );
    expect(query.keyword).not.toContain('senior');
    expect(query.params).toEqual({
      experienceLevel: '4',
      workType: '2',
      location: 'emea',
      geoId: '91000007',
      roleWords: ROLES,
      spellings: ['nest.js', 'nestjs', 'typescript'],
    });
  });

  it('pins an onsite region by its verified geoId', () => {
    expect(
      board({ type: Arrangement.onsite, location: 'europe' }).params,
    ).toMatchObject({
      experienceLevel: '4',
      workType: '1',
      location: 'europe',
      geoId: '100506914',
    });
  });

  it('passes worldwide as the location', () => {
    expect(board({ location: 'worldwide' }).params.location).toBe('worldwide');
  });

  it('pins a location by its verified geoId', () => {
    LINKEDIN_GEO_IDS['paris, france'] = '123';
    try {
      expect(
        board({ type: Arrangement.hybrid, location: 'paris, france' }).params,
      ).toMatchObject({
        experienceLevel: '4',
        workType: '3',
        location: 'paris, france',
        geoId: '123',
      });
    } finally {
      delete LINKEDIN_GEO_IDS['paris, france'];
    }
  });

  it('pins Gulf and European tech-market countries, whatever their casing', () => {
    expect(board({ location: 'united arab emirates' }).params.geoId).toBe(
      '104305776',
    );
    expect(board({ location: 'germany' }).params.geoId).toBe('101282230');
    for (const key of Object.keys(LINKEDIN_GEO_IDS))
      expect(key).toBe(key.trim().toLowerCase());
  });

  it('keeps the verified geoId of a country label', () => {
    expect(
      board({ location: locationKey('United Kingdom') }).params,
    ).toMatchObject({
      experienceLevel: '4',
      workType: '2',
      location: 'united kingdom',
      geoId: '101165590',
    });
  });

  it('searches an unpinned place by its key, with no geoId, so collection fails for it alone', () => {
    const { params } = board({
      ...onsite,
      location: locationKey('Rabat, Morocco'),
    });
    expect(params).toMatchObject({ workType: '1', location: 'rabat, morocco' });
    expect(params).not.toHaveProperty('geoId');
  });

  it('searches every spelling of every technology', () => {
    const spellings = (technologies: string[]) =>
      board({ technologies }).params.spellings;
    expect(spellings(['nextjs'])).toEqual(['next.js', 'nextjs']);
    expect(spellings(['nodejs'])).toEqual(['node.js', 'nodejs']);
    expect(spellings(['go'])).toEqual(['golang']);
  });

  it('sends the one level it is given', () => {
    for (const experienceLevel of ['1', '2', '3', '4', '5'])
      expect(board({ experienceLevel }).params.experienceLevel).toBe(
        experienceLevel,
      );
  });

  it('omits filters it has no value for', () => {
    const params = board({
      experienceLevel: undefined,
      type: Arrangement.unstated,
    }).params;
    expect(params).not.toHaveProperty('experienceLevel');
    expect(params).not.toHaveProperty('workType');
  });
});

describe('linkedinLevels', () => {
  it('splits a seniority into single f_E levels', () => {
    expect(linkedinLevels(Seniority.junior)).toEqual(['2']);
    expect(linkedinLevels(Seniority.mid)).toEqual(['3', '4']);
    expect(linkedinLevels(Seniority.senior)).toEqual(['4']);
    expect(linkedinLevels(Seniority.staff)).toEqual(['4']);
    expect(linkedinLevels(Seniority.lead)).toEqual(['4', '5']);
    expect(linkedinLevels(Seniority.principal)).toEqual(['4', '5']);
  });

  it('has none for an unstated seniority', () => {
    expect(linkedinLevels(Seniority.unstated)).toEqual([]);
  });
});

describe('LinkedIn job board builder, role words and spellings', () => {
  it('builds the keyword from role words and spellings, one level, a pinned geoId', () => {
    const query = build(Channel.LINKEDIN_JOB_BOARD, {
      languages: ['en', 'fr'],
      location: 'europe',
      experienceLevel: '4',
      technologies: ['nodejs', 'typescript'],
    });
    const params = query.params as Record<string, string[] | string>;
    expect(params.roleWords).toContain('ingénieur');
    expect(params.spellings).toContain('node.js');
    expect(params.experienceLevel).toBe('4');
    expect(params.geoId).toBe(LINKEDIN_GEO_IDS['europe']);
    expect(query.keyword).toBe(
      linkedinKeyword(
        params.roleWords as string[],
        params.spellings as string[],
      ),
    );
  });

  it('omits the level and the geoId when there are none', () => {
    const { params } = build(Channel.LINKEDIN_JOB_BOARD, {
      languages: ['en'],
      location: 'asia pacific',
      experienceLevel: undefined,
    });
    expect(params).not.toHaveProperty('experienceLevel');
    expect(params).not.toHaveProperty('geoId');
    expect(params.location).toBe('asia pacific');
  });
});

describe('LinkedIn posts builder', () => {
  it('puts seniority, remote and the location in the query, the actor having no filters', () => {
    const query = build(Channel.LINKEDIN_POSTS, { location: 'morocco' });
    expect(query.keyword).toBe(
      `hiring ${TITLES} nestjs typescript senior remote morocco`,
    );
    expect(query.params).toEqual({});
  });

  it('leaves worldwide out of the query, in any case', () => {
    for (const location of ['worldwide', locationKey('WorldWide')]) {
      expect(build(Channel.LINKEDIN_POSTS, { location }).keyword).toBe(
        `hiring ${TITLES} nestjs typescript senior remote`,
      );
    }
  });

  it('searches onsite and hybrid posts by location, with no word for mid-level', () => {
    expect(
      build(Channel.LINKEDIN_POSTS, { ...onsite, experience: Seniority.mid })
        .keyword,
    ).toBe(`hiring ${TITLES} nestjs typescript casablanca, morocco`);
    expect(
      build(Channel.LINKEDIN_POSTS, {
        type: Arrangement.onsite,
        location: 'europe',
      }).keyword,
    ).toBe(`hiring ${TITLES} nestjs typescript senior europe`);
  });

  it('stays within the actor limits of 500 characters and 5 operators', () => {
    const longest = Object.keys(TECHNOLOGY_TERMS).reduce((a, b) =>
      TECHNOLOGY_TERMS[a].length >= TECHNOLOGY_TERMS[b].length ? a : b,
    );
    for (const position of ENGINEERING_ROLE_KINDS) {
      const { keyword } = build(Channel.LINKEDIN_POSTS, {
        ...onsite,
        position,
        technologies: [longest],
        location: 'x'.repeat(100),
      });
      expect(keyword.length).toBeLessThanOrEqual(500);
      expect(keyword.match(/ (OR|AND|NOT) /g)?.length ?? 0).toBeLessThanOrEqual(
        5,
      );
    }
  });
});

describe('Greenhouse and Ashby builders', () => {
  it('search Google with titles, technologies, seniority, remote and the location', () => {
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY]) {
      expect(build(channel, { location: 'morocco' })).toEqual({
        keyword: `${TITLES} nestjs typescript senior "remote" "morocco"`,
        params: { remote: true },
      });
    }
  });

  it('search onsite boards by the quoted location, with no country code', () => {
    expect(build(Channel.GREEN_HOUSE, onsite)).toEqual({
      keyword: `${TITLES} nestjs typescript senior "casablanca, morocco"`,
      params: { remote: false },
    });
  });

  it('leave worldwide out of the query, in any case', () => {
    for (const location of ['worldwide', locationKey('WorldWide')]) {
      expect(build(Channel.ASHBY, { location }).keyword).toBe(
        `${TITLES} nestjs typescript senior "remote"`,
      );
    }
  });

  it('knows worldwide whatever its spelling', () => {
    expect(isWorldwide(' WorldWide ')).toBe(true);
    expect(isWorldwide('world')).toBe(false);
  });

  it('leave remote out for an unstated arrangement', () => {
    expect(build(Channel.ASHBY, { type: Arrangement.unstated })).toEqual({
      keyword: `${TITLES} nestjs typescript senior "emea"`,
      params: { remote: null },
    });
  });

  it("stay within Google's 32 words", () => {
    for (const position of ENGINEERING_ROLE_KINDS) {
      const { keyword } = build(Channel.ASHBY, { ...onsite, position });
      const words = `site:jobs.ashbyhq.com ${keyword} (intitle:engineer OR intitle:developer) -intitle:manager -intitle:director -intitle:intern`;
      expect(words.split(/\s+/).length).toBeLessThanOrEqual(32);
    }
  });
});

describe('channel query builders', () => {
  it('registers a builder for every channel', () => {
    for (const channel of Object.values(Channel)) {
      expect(CHANNEL_QUERY_BUILDERS[channel].channel).toBe(channel);
    }
  });

  it('registers Greenhouse and Ashby as their own classes with identical queries', () => {
    expect(CHANNEL_QUERY_BUILDERS[Channel.GREEN_HOUSE]).toBeInstanceOf(
      GreenhouseQueryBuilder,
    );
    expect(CHANNEL_QUERY_BUILDERS[Channel.ASHBY]).toBeInstanceOf(
      AshbyQueryBuilder,
    );
    expect(build(Channel.GREEN_HOUSE, onsite)).toEqual(
      build(Channel.ASHBY, onsite),
    );
  });

  it('builds the trial channel exactly like the LinkedIn job board, except channel and hash', () => {
    const combination = {
      ...base,
      location: 'casablanca, morocco',
      type: Arrangement.onsite,
      experienceLevel: '4',
    };
    const main = toRecipe({
      ...combination,
      channel: Channel.LINKEDIN_JOB_BOARD,
    });
    const trial = toRecipe({
      ...combination,
      channel: Channel.LINKEDIN_JOB_BOARD_CHEAP,
    });
    expect(trial.channel).toBe(Channel.LINKEDIN_JOB_BOARD_CHEAP);
    expect(trial.hash).not.toBe(main.hash);
    expect({ ...trial, channel: main.channel, hash: main.hash }).toEqual(main);
  });

  it('pins the LinkedIn job board recipe hash', () => {
    // A literal: it changes only when the recipe or its version does.
    const recipe = toRecipe({
      ...base,
      channel: Channel.LINKEDIN_JOB_BOARD,
      experienceLevel: '4',
    });
    expect(recipe.hash).toBe(
      'd9ffdcc8d4f6f6b41bd02e0263f116829922b1f2a93ff1c3154122bf496f29f8',
    );
  });
});
