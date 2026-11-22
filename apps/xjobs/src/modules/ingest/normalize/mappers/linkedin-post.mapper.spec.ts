import { Channel } from 'src/common/enums';
import company from '../posts/fixtures/company-author.json';
import plain from '../posts/fixtures/plain-post.json';
import share from '../posts/fixtures/share.json';
import { cleanPostText } from '../posts/clean';
import { type DropRule, DROP_RULES } from '../posts/rules';
import { normalize, type NormalizedRecord, RECORD_FIELDS } from '..';
import { jobKey } from '../job-key';
import type { RawPost } from '../posts/payload';
import { mapLinkedinPost } from './linkedin-post.mapper';

// A set `stub.original` replaces the payload's original; undefined reads the real one.
const stub = vi.hoisted(() => ({
  original: undefined as RawPost['original'] | undefined,
}));
vi.mock('../posts/payload', async (importOriginal) => {
  const real = await importOriginal<typeof import('../posts/payload')>();
  return {
    ...real,
    readPostPayload: (p: Record<string, unknown>) => {
      const raw = real.readPostPayload(p);
      return stub.original === undefined
        ? raw
        : { ...raw, original: stub.original };
    },
  };
});

const ctx = { scrapedAt: new Date('2026-11-10T20:32:26.671Z') };

function mapped(payload: Record<string, unknown>): NormalizedRecord {
  const r = mapLinkedinPost(payload, ctx);
  if ('invalid' in r) throw new Error(r.invalid);
  return r;
}

describe('mapLinkedinPost', () => {
  it('maps the fixture', () => {
    const r = mapped(plain);
    expect(r).toMatchObject({
      kind: 'post',
      descriptionText:
        "We're hiring a senior Node.js engineer\n\nRemote in Europe. Send your CV to Jobs@Acme.example and tell us why you fit.\n\nhiring nodejs",
      postingUrl: plain.linkedinUrl,
      postedAt: '2026-10-31T10:00:00.000Z',
      poster: {
        name: 'Jane Doe',
        profileUrl: 'https://www.linkedin.com/in/jane-doe-123',
        type: 'person',
      },
      post: {
        id: plain.id,
        url: plain.linkedinUrl,
        author: {
          key: 'profile:jane-doe-123',
          name: 'Jane Doe',
          headline: 'Engineering Manager at Acme',
          type: 'person',
        },
        original: null,
        links: { emails: ['jobs@acme.example'] },
      },
    });
    expect(r.post?.text).toBe(r.descriptionText);
    const stated = [
      'kind',
      'descriptionText',
      'postingUrl',
      'postedAt',
      'poster',
      'post',
      'closed',
    ];
    for (const f of RECORD_FIELDS)
      if (!stated.includes(f)) expect(r[f], f).toBeNull();
    expect(r.closed).toBe(false);
  });

  it('keys a company page by its universal name', () => {
    const r = mapped({
      ...plain,
      author: { ...plain.author, type: 'company', universalName: 'Acme-Inc' },
    });
    expect(r.post?.author.key).toBe('company:acme-inc');
  });

  it('gives no key without the identifier, with no fallback', () => {
    const r = mapped({
      ...plain,
      author: { ...plain.author, publicIdentifier: null },
    });
    expect(r.post?.author.key).toBeNull();
  });

  it('sorts the article link with the text links', () => {
    const r = mapped({
      ...plain,
      article: {
        link: 'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000001',
      },
    });
    expect(r.post?.links.atsPostings).toHaveLength(1);
  });

  it('marks a post whose text the actor cut at "see more"', () => {
    expect(mapped(plain).post).toMatchObject({
      truncated: false,
      attachedUrls: [],
    });
    const cut = mapped({ ...plain, content: `${plain.content} …see more` });
    expect(cut.post?.truncated).toBe(true);
    expect(cut.post?.text).toBe(mapped(plain).post?.text);
  });

  it('keeps the links attached outside the text', () => {
    const r = mapped({
      ...plain,
      article: { link: 'https://jobs.example/role-1' },
    });
    expect(r.post?.attachedUrls).toEqual(['https://jobs.example/role-1']);
  });

  it('maps an item whose id is a number and whose link is in url', () => {
    const { id: _id, linkedinUrl, ...rest } = plain;
    const r = mapped({ ...rest, id: 7390000000000000, url: linkedinUrl });
    expect(r.post).toMatchObject({ id: '7390000000000000', url: linkedinUrl });
  });

  it('drops a post whose text cleans to nothing', () => {
    expect(mapLinkedinPost({ ...plain, content: ' 🚀 ' }, ctx)).toEqual({
      invalid: 'prepare: no-text',
    });
  });

  it('drops with the rule name and a match trimmed to 80 characters', () => {
    const rule: DropRule = { name: 'test-rule', match: () => 'x'.repeat(120) };
    (DROP_RULES as DropRule[]).push(rule);
    try {
      expect(mapLinkedinPost(plain, ctx)).toEqual({
        invalid: `prepare: test-rule: "${'x'.repeat(80)}"`,
      });
    } finally {
      (DROP_RULES as DropRule[]).pop();
    }
  });

  it('is invalid, never a throw, without an id and a link', () => {
    const { id: _id, linkedinUrl: _url, ...rest } = plain;
    expect(mapLinkedinPost(rest, ctx)).toHaveProperty('invalid');
    expect(mapLinkedinPost({}, ctx)).toHaveProperty('invalid');
  });

  it('is registered for the LINKEDIN_POSTS channel', () => {
    const r = normalize(Channel.LINKEDIN_POSTS, plain, ctx);
    expect(r).toHaveProperty('record');
  });

  it('drops an emoji and "see more" post, but keeps hashtag words', () => {
    expect(mapLinkedinPost({ ...plain, content: '🔥 …see more' }, ctx)).toEqual(
      { invalid: 'prepare: no-text' },
    );
    expect(
      mapped({ ...plain, content: '🔥🔥 #hiring …see more' }).descriptionText,
    ).toBe('hiring');
  });
});

describe('mapLinkedinPost with an original', () => {
  const author = (info: string | null) => ({
    publicIdentifier: 'orig-author',
    universalName: null,
    type: 'person' as const,
    name: 'Orig Author',
    linkedinUrl: 'https://www.linkedin.com/in/orig-author',
    info,
  });
  const original = (text: string | null): RawPost['original'] => ({
    id: '1',
    url: 'https://www.linkedin.com/posts/orig-1',
    text,
    postedAt: null,
    author: author('Original headline'),
    linkUrls: [],
    imageUrls: [],
  });

  afterEach(() => {
    stub.original = undefined;
  });

  it('describes with the original and keeps the share text in post.text', () => {
    stub.original = original('Original 🚀 job text');
    const r = mapped({ ...plain, content: 'My added words' });
    expect(r.descriptionText).toBe('Original job text');
    expect(r.post?.text).toBe('My added words');
    expect(r.post?.original?.text).toBe('Original job text');
    expect(r.post?.original?.author?.key).toBe('profile:orig-author');
    expect(r.post?.original).toMatchObject({
      truncated: false,
      attachedUrls: [],
    });
  });

  it("marks an original whose text was cut, apart from the share's", () => {
    stub.original = original('Original job text …see more');
    const r = mapped({ ...plain, content: 'My added words' });
    expect(r.post?.original?.truncated).toBe(true);
    expect(r.post?.truncated).toBe(false);
  });

  it('runs rules on the original text and headline, not the sharer', () => {
    stub.original = original('Original job text');
    const seen: unknown[] = [];
    const rule: DropRule = {
      name: 'sharer-only',
      match: (i) => {
        seen.push(i);
        return i.text.includes('sharer words') ? 'x' : null;
      },
    };
    (DROP_RULES as DropRule[]).push(rule);
    try {
      expect(
        'invalid' in
          mapLinkedinPost({ ...plain, content: 'sharer words' }, ctx),
      ).toBe(false);
    } finally {
      (DROP_RULES as DropRule[]).pop();
    }
    expect(seen).toEqual([
      { text: 'Original job text', headline: 'Original headline' },
    ]);
  });

  it('drops no-text only when both texts are empty', () => {
    stub.original = original(null);
    expect(mapLinkedinPost({ ...plain, content: '' }, ctx)).toEqual({
      invalid: 'prepare: no-text',
    });
    const own = mapped({ ...plain, content: 'Only added words' });
    expect(own.descriptionText).toBe('Only added words');
    stub.original = original('Original text');
    const orig = mapped({ ...plain, content: '' });
    expect(orig.descriptionText).toBe('Original text');
    expect(orig.post?.text).toBeNull();
  });

  it('sorts links from both texts', () => {
    stub.original = original(
      'Apply: https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000001',
    );
    const r = mapped({ ...plain, content: 'Mail me at me@x.example' });
    expect(r.post?.links.emails).toEqual(['me@x.example']);
    expect(r.post?.links.atsPostings).toHaveLength(1);
  });
});

// No plain repost (no added text) occurs in the real data, so it has no fixture test.
describe('mapLinkedinPost with a real share', () => {
  const keyOf = (payload: Record<string, unknown>) =>
    jobKey(Channel.LINKEDIN_POSTS, `id:${String(payload.id)}`, mapped(payload));
  /**
   * The nested original as that post scraped alone: the nested object has the
   * top-level shape minus `type`, `query` and the always-empty reaction and
   * comment id lists, none of which the mapper reads.
   */
  const alone = (repost: Record<string, unknown>) => ({
    type: 'post',
    ...repost,
  });

  it('keeps the added text and describes with the original', () => {
    const r = mapped(share);
    expect(r.post?.text).toBe(cleanPostText(share.content));
    expect(r.descriptionText).toBe(cleanPostText(share.repost.content));
    expect(r.post?.original).toMatchObject({
      id: share.repost.id,
      url: share.repost.linkedinUrl,
      author: { key: 'profile:iahmediibrahim', name: 'Ahmed Ibrahim' },
      text: cleanPostText(share.repost.content),
      truncated: false,
      attachedUrls: [],
      postedAt: '2026-11-13T10:00:21.305Z',
    });
    expect(r.postedAt).toBe('2026-11-20T18:11:04.175Z');
  });

  it("gets its original's key, the key the original has scraped alone", () => {
    const key = keyOf(share);
    expect(key).toMatch(/^linkedin-post:text:/);
    expect(keyOf(alone(share.repost))).toBe(key);
  });

  it("keys by the original's attachments, never the sharer's", () => {
    const attached = {
      ...share.repost,
      article: { link: 'https://jobs.ashbyhq.com/acme/1' },
      job: {
        linkedinUrl:
          'https://www.linkedin.com/jobs/view/4492769811/?refId=a&trackingId=a',
      },
    };
    const withAttached = { ...share, repost: attached };
    const r = mapped(withAttached);
    expect(r.post?.original?.attachedUrls).toEqual([
      'https://jobs.ashbyhq.com/acme/1',
      'https://www.linkedin.com/jobs/view/4492769811/',
    ]);
    expect(r.post?.links.linkedinJobIds).toEqual(['4492769811']);
    const key = keyOf(withAttached);
    expect(key).not.toBe(keyOf(share));
    expect(keyOf(alone(attached))).toBe(key);
    // A rescrape's new tracking ids keep the key.
    expect(
      keyOf({
        ...share,
        repost: {
          ...attached,
          job: {
            linkedinUrl:
              'https://www.linkedin.com/jobs/view/4492769811/?refId=b&trackingId=b',
          },
        },
      }),
    ).toBe(key);

    const sharerArticle = {
      ...share,
      article: { link: 'https://sharer.example/portfolio' },
    };
    expect(mapped(sharerArticle).post?.attachedUrls).toEqual([
      'https://sharer.example/portfolio',
    ]);
    expect(mapped(sharerArticle).post?.original?.attachedUrls).toEqual([]);
    expect(keyOf(sharerArticle)).toBe(keyOf(share));
  });

  it('reads an attached LinkedIn job into the linked job ids', () => {
    const r = mapped({
      ...company,
      job: {
        title: 'Full Stack Developer',
        linkedinUrl:
          'https://www.linkedin.com/jobs/view/4492857632/?refId=1sl%2FNRX&trackingId=1sl%2FNRX',
      },
    });
    expect(r.post?.links.linkedinJobIds).toEqual(['4492857632']);
    expect(r.post?.attachedUrls).toContain(
      'https://www.linkedin.com/jobs/view/4492857632/',
    );
  });

  it('reads a share whose original is missing or malformed as an original', () => {
    for (const repost of [null, 'x', 7, [], {}]) {
      const r = mapped({ ...share, repost });
      expect(r.post?.original).toBeNull();
      expect(r.descriptionText).toBe(cleanPostText(share.content));
    }
  });
});
