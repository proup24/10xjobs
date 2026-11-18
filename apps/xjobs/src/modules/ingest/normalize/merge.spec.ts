import { Channel } from 'src/common/enums';
import { emptyRecord, type NormalizedRecord } from '.';
import { boardSources, type MergeSource, mergeSources } from './merge';

const t = (day: number) => new Date(Date.UTC(2026, 9, day));
const source = (
  rawItemId: string,
  channel: Channel,
  record: Partial<NormalizedRecord>,
  lastSeenAt = t(1),
  createdAt = t(1),
): MergeSource => ({
  rawItemId,
  channel,
  lastSeenAt,
  createdAt,
  record: emptyRecord({
    kind: channel === Channel.LINKEDIN_POSTS ? 'post' : 'job',
    postingUrl: `https://example.com/${rawItemId}`,
    title: 'Engineer',
    ...record,
  }),
});

const ashby = source('ashby-1', Channel.ASHBY, {
  location: 'Remote (United States | Canada)',
});
const linkedin = source('li-1', Channel.LINKEDIN_JOB_BOARD, {
  location: 'United States',
  companyName: 'Block Labs',
});

describe('mergeSources', () => {
  it('lets the ATS posting win and fills its gaps from LinkedIn', () => {
    const merged = mergeSources([linkedin, ashby]);
    expect(merged.record.location).toBe('Remote (United States | Canada)');
    expect(merged.record.companyName).toBe('Block Labs');
    expect(merged.fieldSources.location).toBe('ashby-1');
    expect(merged.fieldSources.companyName).toBe('li-1');
    expect(merged.record.postingUrl).toBe('https://example.com/ashby-1');
  });

  it('prefers the most recently seen source of the same rank', () => {
    const older = source(
      'li-old',
      Channel.LINKEDIN_JOB_BOARD,
      { title: 'Old' },
      t(1),
    );
    const newer = source(
      'li-new',
      Channel.LINKEDIN_JOB_BOARD,
      { title: 'New' },
      t(2),
    );
    expect(mergeSources([older, newer]).record.title).toBe('New');
  });

  it('breaks a seen-time tie by the most recently created version', () => {
    const a = source(
      'li-a',
      Channel.LINKEDIN_JOB_BOARD,
      { title: 'A' },
      t(2),
      t(1),
    );
    const b = source(
      'li-b',
      Channel.LINKEDIN_JOB_BOARD,
      { title: 'B' },
      t(2),
      t(3),
    );
    expect(mergeSources([a, b]).record.title).toBe('B');
  });

  it('takes nothing but the flag from a closed ATS posting', () => {
    const closed = source('ashby-1', Channel.ASHBY, {
      title: null,
      closed: true,
    });
    const merged = mergeSources([closed, linkedin]);
    expect(merged.record.closed).toBe(true);
    expect(merged.record.location).toBe('United States');
    expect(merged.fieldSources.location).toBe('li-1');
  });

  it('takes the earliest posted time among open sources', () => {
    const li = source('li-1', Channel.LINKEDIN_JOB_BOARD, {
      postedAt: '2026-11-10T12:00:00.000Z',
    });
    const ash = source('ashby-1', Channel.ASHBY, {
      postedAt: '2026-11-09T08:00:00.000Z',
    });
    const merged = mergeSources([li, ash]);
    expect(merged.record.postedAt).toBe('2026-11-09T08:00:00.000Z');
    expect(merged.fieldSources.postedAt).toBe('ashby-1');
  });

  it('ignores the posted time of a closed source, and is null when none states one', () => {
    const closed = source('ashby-1', Channel.ASHBY, {
      closed: true,
      postedAt: '2026-11-01T00:00:00.000Z',
    });
    const li = source('li-1', Channel.LINKEDIN_JOB_BOARD, {
      postedAt: '2026-11-10T12:00:00.000Z',
    });
    expect(mergeSources([closed, li]).record.postedAt).toBe(
      '2026-11-10T12:00:00.000Z',
    );
    const none = mergeSources([ashby, linkedin]);
    expect(none.record.postedAt).toBeNull();
    expect(none.fieldSources.postedAt).toBeUndefined();
  });

  it('is open while any ATS posting is open', () => {
    const closed = source('ashby-1', Channel.ASHBY, { closed: true });
    const open = source('ashby-2', Channel.ASHBY, {});
    expect(mergeSources([closed, open]).record.closed).toBe(false);
  });

  it('is open with only LinkedIn sources', () => {
    expect(mergeSources([linkedin]).record.closed).toBe(false);
  });

  it('is a post only when every source is a post', () => {
    const post = source('post-1', Channel.LINKEDIN_POSTS, {
      title: null,
      descriptionText: 'x',
    });
    expect(mergeSources([post]).record.kind).toBe('post');
    expect(mergeSources([post, linkedin]).record.kind).toBe('job');
  });

  it('gives the same result for any input order', () => {
    const post = source('post-1', Channel.LINKEDIN_POSTS, {
      descriptionText: 'x',
    });
    expect(JSON.stringify(mergeSources([post, linkedin, ashby]))).toBe(
      JSON.stringify(mergeSources([ashby, post, linkedin])),
    );
  });

  it('refuses an empty source list', () => {
    expect(() => mergeSources([])).toThrow();
  });

  it('fills the LinkedIn-only fields from the LinkedIn source over an ATS gap', () => {
    const li = source('li-2', Channel.LINKEDIN_JOB_BOARD, {
      workplaceType: 'remote',
      regionCode: 'EU',
    });
    const merged = mergeSources([ashby, li]);
    expect(merged.record.workplaceType).toBe('remote');
    expect(merged.record.regionCode).toBe('EU');
    expect(merged.record.company).toBeNull();
    expect(merged.fieldSources.workplaceType).toBe('li-2');
  });
});

describe('trial sources', () => {
  const harvest = (record: Partial<NormalizedRecord>) =>
    source('hv-1', Channel.LINKEDIN_JOB_BOARD, record);
  const cheap = (record: Partial<NormalizedRecord>) =>
    source('ch-1', Channel.LINKEDIN_JOB_BOARD_CHEAP, record);

  it('ignores the trial source whenever harvestapi is there', () => {
    const merged = mergeSources([
      cheap({ salary: { text: '$1' } as never, location: 'Lyon' }),
      harvest({ salary: null, location: 'Paris' }),
    ]);
    expect(merged.record.salary).toBeNull();
    expect(merged.record.location).toBe('Paris');
    expect(Object.values(merged.fieldSources)).not.toContain('ch-1');
  });

  it('uses the trial source alone', () => {
    const merged = mergeSources([cheap({ location: 'Lyon' })]);
    expect(merged.record.location).toBe('Lyon');
    expect(merged.fieldSources.location).toBe('ch-1');
  });

  it('ranks the ATS first and lets the trial fill its gaps', () => {
    const merged = mergeSources([
      cheap({ location: 'Lyon', companyName: 'Cheap Co' }),
      ashby,
    ]);
    expect(merged.record.location).toBe('Remote (United States | Canada)');
    expect(merged.record.companyName).toBe('Cheap Co');
    expect(merged.fieldSources.companyName).toBe('ch-1');
  });

  it('ranks a trial source above a post', () => {
    const post = source('po-1', Channel.LINKEDIN_POSTS, { location: 'Post' });
    const merged = mergeSources([post, cheap({ location: 'Lyon' })]);
    expect(merged.record.location).toBe('Lyon');
  });

  it('lets bebity (2.2) win a field over cheap_scraper (2.4) without harvestapi', () => {
    const bebity = source(
      'be-1',
      Channel.LINKEDIN_JOB_BOARD_BEBITY,
      { location: 'Casablanca' },
      t(1),
    );
    // cheap_scraper is seen later: rank, not recency, decides.
    const later = source(
      'ch-2',
      Channel.LINKEDIN_JOB_BOARD_CHEAP,
      { location: 'Rabat', companyName: 'Cheap Co' },
      t(5),
    );
    for (const order of [
      [bebity, later],
      [later, bebity],
    ]) {
      const merged = mergeSources(order);
      expect(merged.record.location).toBe('Casablanca');
      expect(merged.fieldSources.location).toBe('be-1');
      expect(merged.record.companyName).toBe('Cheap Co');
    }
  });

  it('boardSources drops trial sources only beside harvestapi', () => {
    const c = cheap({});
    const h = harvest({});
    expect(boardSources([c, h, ashby])).toEqual([h, ashby]);
    expect(boardSources([c, ashby])).toEqual([c, ashby]);
    expect(boardSources([c])).toEqual([c]);
  });
});
