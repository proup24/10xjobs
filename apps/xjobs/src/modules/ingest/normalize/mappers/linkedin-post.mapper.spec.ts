import { Channel } from 'src/common/enums';
import plain from '../posts/fixtures/plain-post.json';
import { type DropRule, DROP_RULES } from '../posts/rules';
import { normalize, type NormalizedRecord, RECORD_FIELDS } from '..';
import type { RawPost } from '../posts/payload';
import { mapLinkedinPost } from './linkedin-post.mapper';

const stub = vi.hoisted(() => ({ original: null as RawPost['original'] }));
vi.mock('../posts/payload', async (importOriginal) => {
  const real = await importOriginal<typeof import('../posts/payload')>();
  return {
    ...real,
    readPostPayload: (p: Record<string, unknown>) => ({
      ...real.readPostPayload(p),
      original: stub.original,
    }),
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
  });

  afterEach(() => {
    stub.original = null;
  });

  it('describes with the original and keeps the share text in post.text', () => {
    stub.original = original('Original 🚀 job text');
    const r = mapped({ ...plain, content: 'My added words' });
    expect(r.descriptionText).toBe('Original job text');
    expect(r.post?.text).toBe('My added words');
    expect(r.post?.original?.text).toBe('Original job text');
    expect(r.post?.original?.author?.key).toBe('profile:orig-author');
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
