import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import type { QuerySearchCombination } from '../types';
import { AshbyQueryBuilder } from './ashbyhq.builder';
import { GreenhouseQueryBuilder } from './greenhouse.builder';
import { CHANNEL_QUERY_BUILDERS } from '.';

const base: QuerySearchCombination = {
  channel: Channel.LINKEDIN_JOB_BOARD,
  position: Position.backend_engineer,
  locationRegion: Region.EMEA,
  country: null,
  city: null,
  experience: Seniority.senior,
  type: Arrangement.remote,
  technologies: [Technology.nestjs, Technology.typescript],
};

const build = (
  channel: Channel,
  overrides: Partial<QuerySearchCombination> = {},
) => CHANNEL_QUERY_BUILDERS[channel].build({ ...base, channel, ...overrides });

describe('channel query builders', () => {
  it('builds job board keywords', () => {
    expect(build(Channel.LINKEDIN_JOB_BOARD).keywords).toContain(
      'senior backend engineer nestjs typescript',
    );
  });

  it('builds posts keywords with hiring and the arrangement word', () => {
    expect(build(Channel.LINKEDIN_POSTS).keywords).toContain(
      'hiring senior backend engineer nestjs typescript remote',
    );
  });

  it('skips unstated seniority', () => {
    for (const channel of Object.values(Channel)) {
      const query = build(channel, { experience: Seniority.unstated });
      for (const keyword of query.keywords) {
        expect(keyword.startsWith(' ')).toBe(false);
        expect(keyword).not.toContain('unstated');
      }
    }
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, { experience: Seniority.unstated })
        .params,
    ).not.toHaveProperty('experienceLevel');
  });

  it('does not repeat a seniority word the title already starts with', () => {
    const query = build(Channel.LINKEDIN_JOB_BOARD, {
      position: Position.tech_lead,
      experience: Seniority.lead,
    });
    expect(query.keywords.some((k) => k.startsWith('lead tech lead'))).toBe(
      false,
    );
  });

  it('omits the work type and filter remote for unstated arrangement', () => {
    const overrides = { type: Arrangement.unstated };
    expect(
      build(Channel.LINKEDIN_JOB_BOARD, overrides).params,
    ).not.toHaveProperty('workType');
    expect(build(Channel.GREEN_HOUSE, overrides).params.remote).toBeNull();
    expect(build(Channel.ASHBY, overrides).params.remote).toBeNull();
  });

  it('uses city and country for onsite work', () => {
    const overrides = {
      type: Arrangement.onsite,
      country: 'MA',
      city: 'Casablanca',
    };
    expect(build(Channel.LINKEDIN_JOB_BOARD, overrides).params.location).toBe(
      'Casablanca, MA',
    );
    expect(build(Channel.LINKEDIN_POSTS, overrides).params.location).toBe(
      'Casablanca, MA',
    );
    const terms = build(Channel.GREEN_HOUSE, overrides).params
      .locationTerms as string[];
    expect(terms).toEqual(expect.arrayContaining(['MA', 'Casablanca']));
  });

  it('uses the region for remote work', () => {
    expect(build(Channel.LINKEDIN_JOB_BOARD).params.location).toBe('EMEA');
    expect(build(Channel.ASHBY).params).toEqual({
      locationTerms: ['EMEA'],
      remote: true,
    });
  });

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
    const overrides = { country: 'MA', city: 'Casablanca' };
    expect(build(Channel.GREEN_HOUSE, overrides)).toEqual(
      build(Channel.ASHBY, overrides),
    );
  });
});
