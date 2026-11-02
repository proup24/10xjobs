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
import { TECHNOLOGY_TERMS } from '../builders/keywords';
import { AshbyQueryBuilder } from './ashbyhq.builder';
import { GreenhouseQueryBuilder } from './greenhouse.builder';
import { CHANNEL_QUERY_BUILDERS } from '.';
import { isWorldwide, LINKEDIN_GEO_IDS } from './linkedin_geo';
import { linkedinTerm } from './linkedin_board.builder';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: Position.backend_engineer,
  location: 'emea',
  experience: Seniority.senior,
  type: Arrangement.remote,
  technologies: [Technology.nestjs, Technology.typescript],
  domain: SkillDomain.backend,
};

const build = (
  channel: Channel,
  overrides: Partial<QuerySearchCombination> = {},
) => CHANNEL_QUERY_BUILDERS[channel].build({ ...base, channel, ...overrides });

const TITLES =
  '("backend engineer" OR "backend developer" OR "backend software engineer")';
const onsite = { type: Arrangement.onsite, location: 'casablanca, morocco' };

describe('LinkedIn job board builder', () => {
  it('searches the main title and the technologies as plain words, seniority only as f_E', () => {
    const query = build(Channel.LINKEDIN_JOB_BOARD);
    expect(query.keyword).toBe('backend engineer nestjs typescript');
    expect(query.keyword).not.toMatch(/["()]| AND | OR /);
    expect(query.keyword).not.toContain('senior');
    expect(query.params).toEqual({
      experienceLevel: '4',
      workType: '2',
      location: 'emea',
    });
  });

  it('searches an onsite region by its location text, with no geoId', () => {
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, {
        type: Arrangement.onsite,
        location: 'europe',
      }).params,
    ).toEqual({ experienceLevel: '4', workType: '1', location: 'europe' });
  });

  it('passes worldwide as the location', () => {
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, { location: 'worldwide' }).params
        .location,
    ).toBe('worldwide');
  });

  it('pins a location by its verified geoId', () => {
    LINKEDIN_GEO_IDS['paris, france'] = '123';
    try {
      expect(
        build(Channel.LINKEDIN_JOB_BOARD, {
          type: Arrangement.hybrid,
          location: 'paris, france',
        }).params,
      ).toEqual({
        experienceLevel: '4',
        workType: '3',
        location: 'paris, france',
        geoId: '123',
      });
    } finally {
      delete LINKEDIN_GEO_IDS['paris, france'];
    }
  });

  it('uses the short spelling LinkedIn posters write', () => {
    const keyword = (technologies: Technology[]) =>
      build(Channel.LINKEDIN_JOB_BOARD, { technologies }).keyword;
    expect(keyword([Technology.nextjs])).toBe('backend engineer next js');
    expect(keyword([Technology.nodejs])).toBe('backend engineer node js');
    expect(keyword([Technology.spring])).toBe('backend engineer spring');
    expect(keyword([Technology.dotnet])).toBe('backend engineer dotnet');
    expect(keyword([Technology.csharp])).toBe('backend engineer csharp');
    expect(keyword([Technology.cpp])).toBe('backend engineer cpp');
    expect(keyword([Technology.go])).toBe('backend engineer golang');
  });

  it('keeps every LinkedIn term free of quotes and symbols', () => {
    for (const technology of Object.values(Technology))
      expect(linkedinTerm(technology)).toMatch(/^[a-z0-9 ]+$/);
  });

  it('sends several f_E levels where posters tag a seniority loosely', () => {
    const level = (experience: Seniority) =>
      build(Channel.LINKEDIN_JOB_BOARD, { experience }).params.experienceLevel;
    expect(level(Seniority.junior)).toBe('1,2');
    expect(level(Seniority.mid)).toBe('3,4');
    expect(level(Seniority.senior)).toBe('4');
    expect(level(Seniority.staff)).toBe('4,5');
    expect(level(Seniority.lead)).toBe('4,5');
    expect(level(Seniority.principal)).toBe('4,5');
  });

  it('omits filters it has no value for', () => {
    const params = build(Channel.LINKEDIN_JOB_BOARD, {
      experience: Seniority.unstated,
      type: Arrangement.unstated,
    }).params;
    expect(params).not.toHaveProperty('experienceLevel');
    expect(params).not.toHaveProperty('workType');
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
    const longest = Object.values(Technology).reduce((a, b) =>
      TECHNOLOGY_TERMS[a].length >= TECHNOLOGY_TERMS[b].length ? a : b,
    );
    for (const position of Object.values(Position)) {
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
    for (const position of Object.values(Position)) {
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
});
