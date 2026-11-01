import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import type { QuerySearchCombination } from '../types';
import { TECHNOLOGY_TERMS } from '../builders/keywords';
import { AshbyQueryBuilder } from './ashbyhq.builder';
import { GreenhouseQueryBuilder } from './greenhouse.builder';
import { CHANNEL_QUERY_BUILDERS } from '.';
import {
  countryName,
  LINKEDIN_CITY_GEO_IDS,
  LINKEDIN_REGIONS,
} from './linkedin_geo';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: Position.backend_engineer,
  locationRegion: Region.EMEA,
  country: null,
  city: null,
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
const onsite = {
  type: Arrangement.onsite,
  locationRegion: null,
  country: 'MA',
  city: 'Casablanca',
};

describe('LinkedIn job board builder', () => {
  it('ANDs the title alternatives with the technologies, seniority only as f_E', () => {
    const query = build(Channel.LINKEDIN_JOB_BOARD);
    expect(query.keyword).toBe(`${TITLES} AND nestjs typescript`);
    expect(query.keyword).not.toContain('senior');
    expect(query.params).toEqual({
      experienceLevel: '4',
      workType: '2',
      location: 'EMEA',
    });
  });

  it('searches remote regions by LinkedIn location, Worldwide for GLOBAL', () => {
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, { locationRegion: Region.GLOBAL })
        .params.location,
    ).toBe('Worldwide');
    for (const region of Object.values(Region)) {
      const params = build(Channel.LINKEDIN_JOB_BOARD, {
        locationRegion: region,
      }).params;
      expect(params.location).toBe(LINKEDIN_REGIONS[region].location);
      if (LINKEDIN_REGIONS[region].geoId)
        expect(params.geoId).toBe(LINKEDIN_REGIONS[region].geoId);
      else expect(params).not.toHaveProperty('geoId');
    }
  });

  it('names the country, never its ISO code, for onsite work', () => {
    expect(build(Channel.LINKEDIN_JOB_BOARD, onsite).params).toEqual({
      experienceLevel: '4',
      workType: '1',
      location: 'Casablanca, Morocco',
    });
  });

  it('searches the country alone when there is no city', () => {
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, { ...onsite, city: null }).params
        .location,
    ).toBe('Morocco');
  });

  it('pins a city by its verified geoId', () => {
    LINKEDIN_CITY_GEO_IDS['MA|Casablanca'] = '123';
    try {
      expect(build(Channel.LINKEDIN_JOB_BOARD, onsite).params).toMatchObject({
        location: 'Casablanca, Morocco',
        geoId: '123',
      });
    } finally {
      delete LINKEDIN_CITY_GEO_IDS['MA|Casablanca'];
    }
  });

  it('falls back to the code for a country it cannot name', () => {
    for (const code of ['XK', 'ZZ', 'Q1']) {
      const name = countryName(code);
      expect(typeof name).toBe('string');
      expect(name).not.toContain('undefined');
      expect(name.length).toBeGreaterThan(0);
    }
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
  it('puts seniority and remote in the query, the actor having no filters', () => {
    const query = build(Channel.LINKEDIN_POSTS);
    expect(query.keyword).toBe(
      `hiring ${TITLES} nestjs typescript senior remote`,
    );
    expect(query.params).toEqual({});
  });

  it('searches onsite and hybrid posts by city, with no word for mid-level', () => {
    expect(
      build(Channel.LINKEDIN_POSTS, { ...onsite, experience: Seniority.mid })
        .keyword,
    ).toBe(`hiring ${TITLES} nestjs typescript casablanca`);
    expect(
      build(Channel.LINKEDIN_POSTS, { ...onsite, type: Arrangement.hybrid })
        .keyword,
    ).toBe(`hiring ${TITLES} nestjs typescript senior casablanca`);
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
        city: 'x'.repeat(40),
      });
      expect(keyword.length).toBeLessThanOrEqual(500);
      expect(keyword.match(/ (OR|AND|NOT) /g)?.length ?? 0).toBeLessThanOrEqual(
        5,
      );
    }
  });
});

describe('Greenhouse and Ashby builders', () => {
  it('search Google with titles, technologies, seniority and remote', () => {
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY]) {
      expect(build(channel)).toEqual({
        keyword: `${TITLES} nestjs typescript senior "remote"`,
        params: { remote: true },
      });
    }
  });

  it('search onsite boards by city with the country for Google', () => {
    expect(build(Channel.GREEN_HOUSE, onsite)).toEqual({
      keyword: `${TITLES} nestjs typescript senior "casablanca"`,
      params: { remote: false, countryCode: 'ma' },
    });
  });

  it('leave place out for an unstated arrangement', () => {
    expect(build(Channel.ASHBY, { type: Arrangement.unstated })).toEqual({
      keyword: `${TITLES} nestjs typescript senior`,
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
