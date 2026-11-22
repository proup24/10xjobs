import plain from './fixtures/plain-post.json';
import share from './fixtures/share.json';
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

  it('reads a numeric id, as the source key does', () => {
    expect(readPostPayload({ ...plain, id: 7390000000000000 }).id).toBe(
      '7390000000000000',
    );
  });

  it('takes the id from the urn, then from the post URL, without an id', () => {
    const { id: _id, ...noId } = plain;
    expect(
      readPostPayload({ ...noId, urn: 'urn:li:activity:7390000000000000202' })
        .id,
    ).toBe('7390000000000000202');
    expect(readPostPayload(noId).id).toBe('7390000000000000101');
  });

  it('reads the link from url, then postUrl, without linkedinUrl', () => {
    const { linkedinUrl, ...noLink } = plain;
    expect(readPostPayload({ ...noLink, url: linkedinUrl }).url).toBe(
      linkedinUrl,
    );
    expect(readPostPayload({ ...noLink, postUrl: linkedinUrl }).url).toBe(
      linkedinUrl,
    );
  });

  it('has no id or link when the item carries neither', () => {
    const { id: _id, linkedinUrl: _url, ...rest } = plain;
    expect(readPostPayload(rest)).toMatchObject({ id: null, url: null });
  });

  it('readOriginal returns null for the fixture', () => {
    expect(readOriginal(plain)).toBeNull();
  });

  it('reads an attached LinkedIn job as a stable link outside the text', () => {
    const raw = readPostPayload({
      ...plain,
      job: {
        title: 'Full Stack Developer',
        linkedinUrl:
          'https://www.linkedin.com/jobs/view/4492857632/?refId=1sl%2FNRX&trackingId=1sl%2FNRX',
      },
    });
    // refId and trackingId change between scrapes of one post.
    expect(raw.linkUrls).toEqual([
      'https://www.linkedin.com/jobs/view/4492857632/',
    ]);
  });
});

describe('readOriginal', () => {
  it('reads the shared original nested in the payload', () => {
    const original = readOriginal(share);
    expect(original).toMatchObject({
      id: '7526947052816121856',
      url: share.repost.linkedinUrl,
      text: share.repost.content,
      postedAt: '2026-11-13T10:00:21.305Z',
      author: {
        publicIdentifier: 'iahmediibrahim',
        universalName: null,
        type: 'person',
        name: 'Ahmed Ibrahim',
      },
      linkUrls: [],
      imageUrls: [share.repost.postImages[0]!.url],
    });
    expect(readPostPayload(share).original).toEqual(original);
  });

  it("keeps a share's own attachments apart from its original's", () => {
    const raw = readPostPayload({
      ...share,
      article: { link: 'https://sharer.example/portfolio' },
      repost: {
        ...share.repost,
        article: { link: 'https://jobs.ashbyhq.com/acme/1' },
        job: { linkedinUrl: 'https://www.linkedin.com/jobs/view/4492769811/' },
      },
    });
    expect(raw.linkUrls).toEqual(['https://sharer.example/portfolio']);
    expect(raw.imageUrls).toEqual([]);
    expect(raw.original?.linkUrls).toEqual([
      'https://jobs.ashbyhq.com/acme/1',
      'https://www.linkedin.com/jobs/view/4492769811/',
    ]);
  });

  it('reads a repost whose outer text is empty the same way', () => {
    // No plain repost occurs in the real data; this is a share with no added text.
    expect(readOriginal({ ...share, content: '' })).toEqual(
      readOriginal(share),
    );
  });

  it('is null, never a throw, when the original is missing or malformed', () => {
    for (const repost of [undefined, null, 'x', 7, [], [share.repost], {}])
      expect(readOriginal({ ...share, repost })).toBeNull();
    expect(readOriginal({ ...share, repost: { content: '  ' } })).toBeNull();
  });
});
