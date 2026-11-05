import { Channel } from 'src/common/enums';
import { emptyRecord, type NormalizedRecord } from '.';
import { type MergeSource, mergeSources } from './merge';

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
});
