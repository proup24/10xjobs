import { Channel } from 'src/common/enums';
import { emptyRecord, type NormalizedRecord } from '.';
import { canonicalApplyUrl, jobKey } from './job-key';
import type { PostAuthor, PostDetail } from './record';

const ashbyId = '287770d2-dbc7-4372-adf8-c3e2685d85af';
const liJob = (applyUrl: string | null, id = '4483908744') =>
  jobKey(
    Channel.LINKEDIN_JOB_BOARD,
    `id:${id}`,
    emptyRecord({
      kind: 'job',
      title: 'Engineer',
      applyUrl,
      postingUrl: `https://www.linkedin.com/jobs/view/${id}`,
    }),
  );
const atsItem = (
  channel: Channel.ASHBY | Channel.GREEN_HOUSE,
  sourceKey: string,
  record: Partial<NormalizedRecord> = {},
) =>
  jobKey(
    channel,
    sourceKey,
    emptyRecord({
      kind: 'job',
      postingUrl: 'https://www.affirm.com/careers?gh_jid=1',
      ...record,
    }),
  );

describe('jobKey', () => {
  it('unifies a LinkedIn job with the Ashby posting it applies to', () => {
    const fromLinkedin = liJob(
      `https://jobs.ashbyhq.com/block-labs/${ashbyId}/application?utm_source=linkedin`,
    );
    expect(fromLinkedin).toBe(`ats:ashby/block-labs/${ashbyId}`);
    expect(atsItem(Channel.ASHBY, `posting:block-labs/${ashbyId}`)).toBe(
      fromLinkedin,
    );
  });

  it('unifies a LinkedIn job with the Greenhouse job it applies to', () => {
    expect(
      liJob('https://job-boards.greenhouse.io/affirm/jobs/8016868003'),
    ).toBe(atsItem(Channel.GREEN_HOUSE, 'posting:affirm/8016868003'));
  });

  it('reads a Greenhouse embed URL as its board and job', () => {
    expect(
      liJob(
        'https://app.greenhouse.io/embed/job_app?for=affirm&token=8016868003',
      ),
    ).toBe('ats:greenhouse/affirm/8016868003');
  });

  it('keeps different Greenhouse embed jobs apart', () => {
    expect(
      liJob('https://app.greenhouse.io/embed/job_app?for=a&token=111'),
    ).not.toBe(
      liJob('https://app.greenhouse.io/embed/job_app?for=b&token=222'),
    );
  });

  it('keeps job ids carried in the query apart', () => {
    const a = liJob(
      'https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=12345&utm_source=x',
    );
    const b = liJob(
      'https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=67890',
    );
    expect(a).toBe(
      'url:https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=12345',
    );
    expect(a).not.toBe(b);
  });

  it('unifies tracking and fragment variants of one apply URL', () => {
    const tracked = liJob(
      'https://sii.pl/en/job-ads/id/38247/?sii_source=10&utm_source=linkedin.com&utm_medium=referral#apply-contact-form',
      '1',
    );
    expect(tracked).toBe(
      'url:https://sii.pl/en/job-ads/id/38247?sii_source=10',
    );
    expect(liJob('https://SII.pl/en/job-ads/id/38247?sii_source=10', '2')).toBe(
      tracked,
    );
  });

  it('falls back to the LinkedIn id for an apply URL with no identifier', () => {
    expect(liJob('https://acme.com/careers/')).toBe('linkedin-job:4483908744');
  });

  it('falls back to the LinkedIn id without an apply URL', () => {
    expect(liJob(null)).toBe('linkedin-job:4483908744');
  });

  it('falls back for apply URLs that are not usable web URLs', () => {
    expect(liJob('mailto:jobs@acme.com')).toBe('linkedin-job:4483908744');
    expect(liJob('not a url')).toBe('linkedin-job:4483908744');
    expect(liJob('https://es.linkedin.com/jobs/view/1234567')).toBe(
      'linkedin-job:4483908744',
    );
  });

  it('keeps a post on its own, even with an article link', () => {
    expect(
      jobKey(
        Channel.LINKEDIN_POSTS,
        'id:7390000000000000001',
        emptyRecord({
          kind: 'post',
          descriptionText: 'hiring',
          applyUrl: `https://jobs.ashbyhq.com/acme/${ashbyId}`,
          postingUrl: 'https://www.linkedin.com/posts/x',
        }),
      ),
    ).toBe('linkedin-post:7390000000000000001');
  });

  it('keys an ATS item by its posting, closed or not', () => {
    expect(
      atsItem(Channel.ASHBY, `posting:acme/${ashbyId}`, { closed: true }),
    ).toBe(`ats:ashby/acme/${ashbyId}`);
  });

  it('gives one key to copies of one apply URL under different titles', () => {
    const listing =
      'https://recruiting.paylocity.com/Recruiting/Jobs/All/7a3e1b2c-0000-4000-8000-000000000001';
    const keyFor = (title: string | null, id: string) =>
      jobKey(
        Channel.LINKEDIN_JOB_BOARD,
        `id:${id}`,
        emptyRecord({
          kind: 'job',
          title,
          descriptionText: 'x',
          applyUrl: listing,
          postingUrl: `https://www.linkedin.com/jobs/view/${id}`,
        }),
      );
    expect(keyFor('Backend Engineer', '1')).toBe(`url:${listing}`);
    expect(keyFor('Frontend Engineer', '2')).toBe(
      keyFor('Backend Engineer', '1'),
    );
  });

  it('keys a URL without a title by the URL', () => {
    const listing = 'https://acme.com/jobs/99999';
    expect(
      jobKey(
        Channel.LINKEDIN_JOB_BOARD,
        'id:4483908744',
        emptyRecord({
          kind: 'job',
          title: null,
          descriptionText: 'x',
          applyUrl: listing,
          postingUrl: 'https://www.linkedin.com/jobs/view/4483908744',
        }),
      ),
    ).toBe(`url:${listing}`);
  });

  it('keys a trial-channel job with no apply URL by its LinkedIn id', () => {
    expect(
      jobKey(
        Channel.LINKEDIN_JOB_BOARD_CHEAP,
        'id:4123',
        emptyRecord({
          kind: 'job',
          title: 'Engineer',
          applyUrl: null,
          postingUrl: 'https://www.linkedin.com/jobs/view/4123',
        }),
      ),
    ).toBe('linkedin-job:4123');
  });

  it('never adds the title to an ATS key', () => {
    expect(liJob(`https://jobs.ashbyhq.com/acme/${ashbyId}`)).toBe(
      `ats:ashby/acme/${ashbyId}`,
    );
  });
});

describe('canonicalApplyUrl', () => {
  it('sorts the remaining parameters', () => {
    expect(canonicalApplyUrl('https://a.com/j/12345?b=2&a=1&ref=x&src=y')).toBe(
      'https://a.com/j/12345?a=1&b=2',
    );
  });
});

describe('jobKey for trial channels', () => {
  const record = emptyRecord({
    kind: 'job',
    title: 'Engineer',
    applyUrl: 'https://boards.greenhouse.io/acme/jobs/9',
    postingUrl: 'https://www.linkedin.com/jobs/view/123',
  });
  it('keys a trial item by its LinkedIn id even with an ATS apply URL', () => {
    for (const channel of [
      Channel.LINKEDIN_JOB_BOARD_CHEAP,
      Channel.LINKEDIN_JOB_BOARD_BEBITY,
    ])
      expect(jobKey(channel, 'id:123', record)).toBe('linkedin-job:123');
    expect(jobKey(Channel.LINKEDIN_JOB_BOARD, 'id:123', record)).toBe(
      'ats:greenhouse/acme/9',
    );
  });
});

describe('jobKey for posts', () => {
  const author = (key: string | null): PostAuthor => ({
    key,
    name: null,
    profileUrl: null,
    headline: null,
    type: null,
  });
  const long =
    'We are hiring a senior backend engineer to join our platform team. Remote within Europe, TypeScript and Postgres, apply by email today.';
  const post = (
    id: string,
    text: string | null,
    authorKey: string | null,
    original: { id: string | null; text: string | null } | null = null,
  ): string => {
    const detail: PostDetail = {
      id,
      url: `https://www.linkedin.com/feed/update/${id}`,
      author: author(original ? 'profile:sharer' : authorKey),
      text: original ? 'my take' : text,
      postedAt: null,
      original: original
        ? {
            id: original.id,
            url: null,
            author: author(authorKey),
            text: original.text,
            postedAt: null,
          }
        : null,
      links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
    };
    return jobKey(
      Channel.LINKEDIN_POSTS,
      `id:${id}`,
      emptyRecord({
        kind: 'post',
        postingUrl: detail.url,
        post: detail,
      }),
    );
  };

  it('gives one key to the same author and text under different post ids', () => {
    const a = post('1', long, 'profile:ada');
    expect(a).toMatch(/^linkedin-post:text:[0-9a-f]{32}$/);
    expect(post('2', long, 'profile:ada')).toBe(a);
  });

  it('gives a share the key of its original', () => {
    expect(post('3', null, 'profile:ada', { id: 'X', text: long })).toBe(
      post('1', long, 'profile:ada'),
    );
  });

  it('separates the same text under different authors', () => {
    expect(post('1', long, 'profile:ada')).not.toBe(
      post('1', long, 'profile:bob'),
    );
  });

  it('falls back to the id for short text, own or original', () => {
    const short = 'x'.repeat(60);
    expect(post('7', short, 'profile:ada')).toBe('linkedin-post:7');
    expect(post('7', short, 'profile:ada', { id: 'X', text: short })).toBe(
      'linkedin-post:X',
    );
    expect(post('7', null, 'profile:ada', { id: null, text: null })).toBe(
      'linkedin-post:7',
    );
  });

  it('falls back to the id when the author key is unknown', () => {
    expect(post('8', long, null)).toBe('linkedin-post:8');
  });

  it('ignores accents, case, emoji and punctuation', () => {
    const variant = `🚀 ${long.toUpperCase().replace('EUROPE', 'Europé')}!!`;
    expect(post('1', variant, 'profile:ada')).toBe(
      post('2', long, 'profile:ada'),
    );
  });

  it('does not throw when a post record lacks its post', () => {
    expect(
      jobKey(
        Channel.LINKEDIN_POSTS,
        'id:9',
        emptyRecord({
          kind: 'post',
          postingUrl: 'https://www.linkedin.com/feed/update/9',
        }),
      ),
    ).toBe('linkedin-post:9');
  });
});
