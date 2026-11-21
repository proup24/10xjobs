import plain from './fixtures/plain-post.json';
import { readOriginal, readPostPayload } from './payload';

describe('readPostPayload', () => {
  it('reads the fixture', () => {
    const raw = readPostPayload(plain);
    expect(raw).toMatchObject({
      id: '7390000000000000101',
      url: plain.linkedinUrl,
      text: plain.content,
      postedAt: '2026-10-31T10:00:00.000Z',
      author: {
        publicIdentifier: 'Jane-Doe-123',
        universalName: 'jane-doe',
        type: 'person',
        name: 'Jane Doe',
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe-123',
        info: 'Engineering Manager at Acme',
      },
      imageUrls: [],
      linkUrls: [],
      original: null,
    });
  });

  it('maps author types', () => {
    const type = (t: string) =>
      readPostPayload({ ...plain, author: { ...plain.author, type: t } }).author
        .type;
    expect(type('profile')).toBe('person');
    expect(type('company')).toBe('company');
    expect(type('other')).toBeNull();
  });

  it('gives all-null author fields when the author is missing', () => {
    const { author: _author, ...rest } = plain;
    expect(readPostPayload(rest).author).toEqual({
      publicIdentifier: null,
      universalName: null,
      type: null,
      name: null,
      linkedinUrl: null,
      info: null,
    });
  });

  it('reads the article link as a link outside the text', () => {
    const raw = readPostPayload({
      ...plain,
      article: { link: 'https://jobs.ashbyhq.com/acme/1' },
    });
    expect(raw.linkUrls).toEqual(['https://jobs.ashbyhq.com/acme/1']);
  });

  it('readOriginal returns null for the fixture', () => {
    expect(readOriginal(plain)).toBeNull();
  });
});
