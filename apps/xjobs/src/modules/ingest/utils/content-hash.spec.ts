import { Channel } from 'src/common/enums';
import ashbyFailed from './fixtures/ashby-failed.json';
import ashby from './fixtures/ashby.json';
import linkedinJob from './fixtures/linkedin-job.json';
import cheapJob from './fixtures/linkedin-job-cheap.json';
import harvestJobs from './fixtures/linkedin-job-harvest.json';
import linkedinPost from './fixtures/linkedin-post.json';
import indeedJobs from './fixtures/indeed-valig.json';
import { contentHash } from './content-hash';

describe('contentHash', () => {
  it('is a sha256 hex digest', () => {
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('ignores key order at every depth', () => {
    const reverse = <T extends object>(o: T) =>
      Object.fromEntries(Object.entries(o).reverse()) as T;
    const reordered = {
      ...reverse(linkedinPost),
      article: reverse(linkedinPost.article),
    };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(linkedinPost));
    expect(contentHash(Channel.LINKEDIN_POSTS, reordered)).toBe(
      contentHash(Channel.LINKEDIN_POSTS, linkedinPost),
    );
  });

  it('ignores the volatile fields of LinkedIn jobs', () => {
    const later = {
      ...linkedinJob,
      scrapingInfo: { page: 2, inputUrl: 'https://other', index: 9 },
      postedTime: '5 hours ago',
      applicationsCount: '90 applicants',
      companyLogo: 'https://media.licdn.com/logo?e=1&t=sig2',
    };
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, later)).toBe(
      contentHash(Channel.LINKEDIN_JOB_BOARD, linkedinJob),
    );
  });

  it("ignores employer ratings and images in an Indeed item's hash", () => {
    const [item] = indeedJobs as unknown as {
      title: string;
      employer?: Record<string, unknown>;
    }[];
    const base = {
      ...item!,
      employer: {
        ...item!.employer,
        ratingsCount: 10,
        ratingsValue: 4.1,
        logoUrl: 'https://a/logo.png',
      },
    };
    const later = {
      ...base,
      employer: {
        ...base.employer,
        ratingsCount: 11,
        ratingsValue: 4.2,
        logoUrl: 'https://b/logo.png',
        headerImageUrl: 'https://b/h.png',
        ceoPhotoUrl: 'https://b/c.png',
      },
    };
    const hash = (x: unknown) => contentHash(Channel.INDEED, x);
    expect(hash(later)).toBe(hash(base));
    expect(hash({ ...base, title: 'Another title' })).not.toBe(hash(base));
  });

  it('ignores what changes on an unchanged harvestapi job, and sees a changed description', () => {
    const [harvest] = harvestJobs;
    const later = {
      ...harvest,
      company: {
        ...harvest.company,
        logo: 'https://media.licdn.com/other-logo',
        logos: [],
        backgroundCover: 'https://media.licdn.com/other-cover',
        backgroundCovers: [],
        followerCount: 1,
        employeeCount: 2,
      },
      applicants: 'many',
      views: 999,
      new: !harvest.new,
      _meta: { pagination: { totalElements: 1 } },
      query: { search: 'another search' },
      headerCaptionText: 'Acme\nElsewhere\n2 days ago',
    };
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, later)).toBe(
      contentHash(Channel.LINKEDIN_JOB_BOARD, harvest),
    );
    expect(
      contentHash(Channel.LINKEDIN_JOB_BOARD, {
        ...harvest,
        descriptionText: `${harvest.descriptionText} Changed.`,
      }),
    ).not.toBe(contentHash(Channel.LINKEDIN_JOB_BOARD, harvest));
  });

  it('ignores the search a cheap_scraper job was found by', () => {
    const later = {
      ...cheapJob,
      searchString: 'typescript - Germany',
      postedTime: '9 hours ago',
    };
    expect(contentHash(Channel.LINKEDIN_JOB_BOARD, later)).toBe(
      contentHash(Channel.LINKEDIN_JOB_BOARD, cheapJob),
    );
  });

  it('ignores what changes on an unchanged post: query, relative time, author followers and avatar', () => {
    const later = {
      ...linkedinPost,
      query: { ...linkedinPost.query, search: 'another search', page: 3 },
      postedAt: { ...linkedinPost.postedAt, postedAgoShort: '1d' },
      author: {
        ...linkedinPost.author,
        info: 'Engineering Manager at Acme • 1,350 followers',
        avatar: { url: 'https://media.licdn.com/x?e=1800000000&t=sig2' },
      },
    };
    expect(contentHash(Channel.LINKEDIN_POSTS, later)).toBe(
      contentHash(Channel.LINKEDIN_POSTS, linkedinPost),
    );
  });

  it('still sees a post edit and an author change', () => {
    expect(
      contentHash(Channel.LINKEDIN_POSTS, {
        ...linkedinPost,
        content: 'Edited.',
      }),
    ).not.toBe(contentHash(Channel.LINKEDIN_POSTS, linkedinPost));
    expect(
      contentHash(Channel.LINKEDIN_POSTS, {
        ...linkedinPost,
        author: { ...linkedinPost.author, name: 'John Roe' },
      }),
    ).not.toBe(contentHash(Channel.LINKEDIN_POSTS, linkedinPost));
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

  it('ignores a LinkedIn post document manifest, which rescrapes garble', () => {
    const a = {
      ...linkedinPost,
      document: { title: 'Resume', manifest: { asset: 'urn:li:x' } },
    };
    const b = {
      ...linkedinPost,
      document: { title: 'Resume', manifest: '\u0000garbled' },
    };
    expect(contentHash(Channel.LINKEDIN_POSTS, a)).toBe(
      contentHash(Channel.LINKEDIN_POSTS, b),
    );
  });
});
