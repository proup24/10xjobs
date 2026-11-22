import type { PostDetail } from '../../ingest/normalize/record';

type Author = PostDetail['author'];

export const ACME_AUTHOR: Author = {
  key: 'acme-recruiter',
  name: 'Dana Recruiter',
  profileUrl: 'https://www.linkedin.com/in/dana-recruiter',
  headline: 'Talent at Acme',
  type: 'person',
};

export const SHARER_AUTHOR: Author = {
  key: 'sam-sharer',
  name: 'Sam Sharer',
  profileUrl: 'https://www.linkedin.com/in/sam-sharer',
  headline: 'Engineering Manager',
  type: 'person',
};

/** A post detail with no links; `over` overrides any field. */
export function postDetail(over: Partial<PostDetail> = {}): PostDetail {
  return {
    id: 'p1',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:p1',
    author: ACME_AUTHOR,
    text: 'Acme is hiring a Senior Backend Engineer. Remote in Europe.',
    truncated: false,
    attachedUrls: [],
    postedAt: '2026-11-10T09:00:00.000Z',
    original: null,
    links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
    ...over,
  };
}

/** A plain original post (not a share) that names no email. */
export const plainOriginal: PostDetail = postDetail({
  id: 'orig-1',
  links: {
    emails: [],
    linkedinJobIds: ['4111111111'],
    atsPostings: [
      {
        provider: 'greenhouse',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
      },
    ],
    other: [],
  },
});

/**
 * A share of `plainOriginal`: `jobs@acme.com` appears only in the sharer's
 * added text, never in the original.
 */
export const shareWithEmail: PostDetail = postDetail({
  id: 'share-1',
  url: 'https://www.linkedin.com/feed/update/urn:li:activity:share-1',
  author: SHARER_AUTHOR,
  text: 'DM me or email jobs@acme.com',
  postedAt: '2026-11-11T09:00:00.000Z',
  original: {
    id: plainOriginal.id,
    url: plainOriginal.url,
    author: plainOriginal.author,
    text: plainOriginal.text,
    truncated: false,
    attachedUrls: [],
    postedAt: plainOriginal.postedAt,
  },
  links: {
    emails: ['jobs@acme.com'],
    linkedinJobIds: [],
    atsPostings: [],
    other: [],
  },
});

/** Another share of the same original, repeating the email. */
export const secondShare: PostDetail = postDetail({
  id: 'share-2',
  author: { ...SHARER_AUTHOR, key: 'kim-sharer', name: 'Kim Sharer' },
  text: 'Great team. jobs@acme.com',
  original: shareWithEmail.original,
  links: {
    emails: ['jobs@acme.com'],
    linkedinJobIds: [],
    atsPostings: [],
    other: [],
  },
});
