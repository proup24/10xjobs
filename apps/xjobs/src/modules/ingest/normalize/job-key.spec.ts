import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import { emptyRecord, type NormalizedRecord } from '.';
import { canonicalApplyUrl, jobKey, linkKeysOf } from './job-key';
import fixtures from '../utils/fixtures/indeed-valig.json';
import { normalize } from './normalize';
import { comparableText } from './posts/clean';
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

  it('unifies one posting seen through LinkedIn and Indeed board markers', () => {
    const base = 'https://jobs.lever.co/acme/1234-5678';
    expect(liJob(`${base}?lever-source=LinkedIn`)).toBe(
      liJob(`${base}?lever-source=Indeed`),
    );
    expect(liJob(`${base}?iis=Indeed&iisn=Indeed&indeed-apply-token=abc`)).toBe(
      liJob(base),
    );
    expect(liJob(`${base}?jobSite=Indeed`)).toBe(liJob(base));
    expect(
      liJob(
        'https://acme.bamboohr.com/careers/25?source=indeed&postedDate=2026-11-23',
      ),
    ).toBe(liJob('https://acme.bamboohr.com/careers/25'));
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
    original: {
      id: string | null;
      text: string | null;
      truncated?: boolean;
      attachedUrls?: string[];
    } | null = null,
    own: { truncated?: boolean; attachedUrls?: string[] } = {},
  ): string => {
    const detail: PostDetail = {
      id,
      url: `https://www.linkedin.com/feed/update/${id}`,
      author: author(original ? 'profile:sharer' : authorKey),
      text: original ? 'my take' : text,
      truncated: own.truncated ?? false,
      attachedUrls: own.attachedUrls ?? [],
      postedAt: null,
      original: original
        ? {
            id: original.id,
            url: null,
            author: author(authorKey),
            text: original.text,
            truncated: original.truncated ?? false,
            attachedUrls: original.attachedUrls ?? [],
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

  it('keeps the exact fingerprint of author and text without attachments', () => {
    const digest = createHash('sha256')
      .update(
        'profile:ada\nwe are hiring a senior backend engineer to join our platform team remote within europe typescript and postgres apply by email today',
      )
      .digest('hex')
      .slice(0, 32);
    expect(post('1', long, 'profile:ada')).toBe(`linkedin-post:text:${digest}`);
  });

  it('separates same-author texts that attach different links', () => {
    const a = post('1', long, 'profile:ada', null, {
      attachedUrls: ['https://jobs.example/1'],
    });
    const b = post('2', long, 'profile:ada', null, {
      attachedUrls: ['https://jobs.example/2'],
    });
    expect(a).toMatch(/^linkedin-post:text:[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe(post('3', long, 'profile:ada'));
  });

  it('ignores the order and repeats of attached links', () => {
    const urls = ['https://jobs.example/b', 'https://jobs.example/a'];
    expect(post('1', long, 'profile:ada', null, { attachedUrls: urls })).toBe(
      post('2', long, 'profile:ada', null, {
        attachedUrls: [urls[1]!, urls[0]!, urls[1]!],
      }),
    );
  });

  it('falls back to the id for a truncated text, own or original', () => {
    expect(post('5', long, 'profile:ada', null, { truncated: true })).toBe(
      'linkedin-post:5',
    );
    expect(
      post('5', null, 'profile:ada', { id: 'X', text: long, truncated: true }),
    ).toBe('linkedin-post:X');
  });

  it("keys a share by its original's text, whatever the share's own text", () => {
    expect(
      post(
        '6',
        null,
        'profile:ada',
        { id: 'X', text: long },
        { truncated: true, attachedUrls: ['https://jobs.example/9'] },
      ),
    ).toBe(post('1', long, 'profile:ada'));
  });

  it('needs at least 100 comparable characters for the text key', () => {
    const of = (n: number) => 'a'.repeat(n);
    expect(comparableText(of(99))).toHaveLength(99);
    expect(post('7', of(99), 'profile:ada')).toBe('linkedin-post:7');
    expect(post('7', of(100), 'profile:ada')).toMatch(
      /^linkedin-post:text:[0-9a-f]{32}$/,
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

describe('linkKeysOf', () => {
  it('names a LinkedIn job by its id', () => {
    expect(
      linkKeysOf(['https://www.linkedin.com/jobs/view/4490421090/?trk=x']),
    ).toEqual(['linkedin-job:4490421090']);
  });

  it('names an Ashby or Greenhouse posting by its ats key', () => {
    expect(
      linkKeysOf(['https://boards.greenhouse.io/affirm/jobs/6544291003']),
    ).toEqual(['ats:greenhouse/affirm/6544291003']);
    expect(
      linkKeysOf([`https://jobs.ashbyhq.com/acme/${ashbyId}?utm_source=x`]),
    ).toEqual([`ats:ashby/acme/${ashbyId}`]);
  });

  it('keeps a url with an identifier as its canonical url', () => {
    expect(
      linkKeysOf([
        'https://jobs.lever.co/acme/5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f/?utm_source=x',
      ]),
    ).toEqual([
      'url:https://jobs.lever.co/acme/5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    ]);
  });

  it('drops a link that names no job', () => {
    expect(
      linkKeysOf([
        'https://example.com/careers',
        'not a url',
        'https://www.linkedin.com/in/someone',
      ]),
    ).toEqual([]);
  });

  it('removes duplicates and sorts', () => {
    expect(
      linkKeysOf([
        'https://www.linkedin.com/jobs/view/2/',
        'https://www.linkedin.com/jobs/view/1/?x=1',
        'https://www.linkedin.com/jobs/view/2/?trk=y',
      ]),
    ).toEqual(['linkedin-job:1', 'linkedin-job:2']);
  });
});

describe('jobKey for Indeed', () => {
  const [remote, moroccan] = fixtures as Record<string, any>[];
  const record = (item: unknown, applyUrl?: string | null) => {
    const result = normalize(Channel.INDEED, item, {
      scrapedAt: new Date('2026-11-27T00:00:00.000Z'),
    });
    if (!('record' in result)) throw new Error(result.invalid);
    return applyUrl === undefined
      ? result.record
      : { ...result.record, applyUrl };
  };
  const indeed = (rec: NormalizedRecord, key = 'abc123') =>
    jobKey(Channel.INDEED, `jk:${key}`, rec);

  it("joins an Indeed job to harvestapi's job for the same Workday link", () => {
    const rec = record(remote);
    expect(rec.applyUrl).toContain('source=Indeed');
    const key = indeed(rec);
    expect(key.startsWith('url:')).toBe(true);
    expect(key).toBe(liJob(rec.applyUrl));
  });

  it('keys an Indeed job with a Greenhouse link by its posting', () => {
    const rec = record(
      remote,
      'https://job-boards.greenhouse.io/affirm/jobs/8016868003',
    );
    expect(indeed(rec).startsWith('ats:greenhouse/')).toBe(true);
  });

  it('falls back to indeed-job for an Indeed-hosted link', () => {
    const rec = record(moroccan);
    expect(rec.applyUrl).toBeNull();
    expect(indeed(rec, 'k9')).toBe('indeed-job:k9');
  });

  it('falls back to indeed-job for a link with no identifier', () => {
    const rec = record(remote, 'https://acme.com/careers');
    expect(indeed(rec, 'k9')).toBe('indeed-job:k9');
  });
});
