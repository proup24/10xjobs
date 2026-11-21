import { Channel } from 'src/common/enums';
import plain from '../posts/fixtures/plain-post.json';
import { type DropRule, DROP_RULES } from '../posts/rules';
import { normalize, type NormalizedRecord } from '..';
import { mapLinkedinPost } from './linkedin-post.mapper';

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
    for (const f of [
      'title',
      'companyName',
      'companyUrl',
      'location',
      'salary',
      'applyUrl',
      'company',
      'publishedAt',
    ] as const)
      expect(r[f]).toBeNull();
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
});
