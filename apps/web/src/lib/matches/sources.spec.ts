import { describe, expect, it } from 'vitest';
import { channelBadges, sourceOf, sourceText } from './sources';

describe('channelBadges', () => {
  it('names the actor on LinkedIn job-board channels, harvestapi first', () => {
    expect(
      channelBadges([
        'LINKEDIN_JOB_BOARD_CHEAP',
        'ASHBY',
        'LINKEDIN_JOB_BOARD',
      ]),
    ).toEqual(['LinkedIn · harvestapi', 'LinkedIn · cheap_scraper', 'Ashby']);
  });
  it('dedupes', () => {
    expect(channelBadges(['ASHBY', 'ASHBY'])).toEqual(['Ashby']);
  });
});

describe('sourceText', () => {
  it('names LinkedIn once for both channels', () => {
    expect(sourceText(['LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP'])).toBe(
      'LinkedIn',
    );
  });
  it('joins distinct labels', () => {
    expect(sourceText(['GREEN_HOUSE', 'LINKEDIN_JOB_BOARD_CHEAP'])).toBe(
      'Greenhouse and LinkedIn',
    );
  });
});

describe('sourceOf', () => {
  it('folds both job-board channels into one source', () => {
    expect(sourceOf('LINKEDIN_JOB_BOARD_CHEAP')).toBe('LINKEDIN_JOB_BOARD');
    expect(sourceOf('ASHBY')).toBe('ASHBY');
  });
});
