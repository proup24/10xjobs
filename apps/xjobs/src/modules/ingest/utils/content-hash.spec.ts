import { Channel } from 'src/common/enums';
import ashbyFailed from './fixtures/ashby-failed.json';
import ashby from './fixtures/ashby.json';
import linkedinJob from './fixtures/linkedin-job.json';
import linkedinPost from './fixtures/linkedin-post.json';
import { contentHash } from './content-hash';

describe('contentHash', () => {
  it('is a sha256 hex digest', () => {
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('ignores key order at every depth', () => {
    const reordered = Object.fromEntries(Object.entries(linkedinJob).reverse());
    reordered.scrapingInfo = {
      index: 3,
      inputUrl: linkedinJob.scrapingInfo.inputUrl,
    };
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, reordered)).toBe(
      contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob),
    );
  });

  it('ignores the volatile fields of LinkedIn jobs', () => {
    const later = {
      ...linkedinJob,
      scrapingInfo: { inputUrl: 'https://other', index: 9 },
      postedTime: '5 hours ago',
      applicantsCount: '40',
    };
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, later)).toBe(
      contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob),
    );
  });

  it('ignores engagement counters on posts', () => {
    const later = {
      ...linkedinPost,
      engagement: { likes: 99, comments: 9, shares: 4 },
    };
    expect(contentHash(Channel.LINKEDIN_POSTS, later)).toBe(
      contentHash(Channel.LINKEDIN_POSTS, linkedinPost),
    );
  });

  it('ignores the Google hit of an ATS posting, not the posting', () => {
    const otherHit = {
      ...ashby,
      hit: { ...ashby.hit, position: 9, title: 'x' },
    };
    expect(contentHash(Channel.ASHBY, otherHit)).toBe(
      contentHash(Channel.ASHBY, ashby),
    );
    expect(contentHash(Channel.ASHBY, ashbyFailed)).not.toBe(
      contentHash(Channel.ASHBY, ashby),
    );
  });

  it('changes when the content changes', () => {
    expect(
      contentHash(Channel.LINKEDIN_JOB_BOARD, {
        ...linkedinJob,
        descriptionHtml: '<p>Build other APIs.</p>',
      }),
    ).not.toBe(contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob));
  });
});
