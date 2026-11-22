import type { NormalizeContext } from '../normalize';
import { httpUrl } from '../linkedin';
import { cleanPostText, hasSeeMoreTail, sortLinks } from '../posts/clean';
import { readPostPayload, type RawPost } from '../posts/payload';
import { firstDrop } from '../posts/rules';
import {
  emptyRecord,
  type NormalizedRecord,
  type PostAuthor,
  type PostDetail,
} from '../record';

const link = (value: string | null) =>
  value ? (httpUrl(value)?.toString() ?? null) : null;

/** The author as a post record stores it, with its silence key. */
export function authorOf(a: RawPost['author']): PostAuthor {
  const id =
    a.type === 'person'
      ? a.publicIdentifier
      : a.type === 'company'
        ? a.universalName
        : null;
  return {
    key:
      id && a.type
        ? `${a.type === 'person' ? 'profile' : 'company'}:${id.toLowerCase()}`
        : null,
    name: a.name,
    profileUrl: link(a.linkedinUrl),
    headline: a.info,
    type: a.type,
  };
}

/**
 * What a post object's own payload says about its text and attachments, read
 * the same way for a post and for the original it shares, so a share keys
 * exactly like its original scraped alone.
 */
function ownParts(p: { text: string | null; linkUrls: string[] }) {
  return {
    truncated: hasSeeMoreTail(p.text ?? ''),
    attachedUrls: [...new Set(p.linkUrls)],
  };
}

/** The post as a record stores it, from its cleaned texts. Pure. */
export function postDetailOf(
  raw: RawPost,
  id: string,
  postingUrl: string,
  ownText: string,
  originalText: string,
): PostDetail {
  const original = raw.original;
  const author = authorOf(raw.author);
  return {
    id,
    url: postingUrl,
    author,
    text: ownText || null,
    ...ownParts(raw),
    postedAt: raw.postedAt,
    original: original
      ? {
          id: original.id,
          url: link(original.url),
          author:
            original.author.name ||
            original.author.publicIdentifier ||
            original.author.universalName
              ? authorOf(original.author)
              : null,
          text: originalText || null,
          ...ownParts(original),
          postedAt: original.postedAt,
        }
      : null,
    links: sortLinks([raw.text ?? '', original?.text ?? ''].join('\n'), [
      ...raw.linkUrls,
      ...(original?.linkUrls ?? []),
    ]),
  };
}

/** A LinkedIn post (harvestapi/linkedin-post-search item). Pure. */
export function mapLinkedinPost(
  payload: Record<string, unknown>,
  _ctx: NormalizeContext,
): NormalizedRecord | { invalid: string } {
  const raw = readPostPayload(payload);
  const postingUrl = link(raw.url);
  if (!raw.id || !postingUrl)
    return { invalid: 'normalize: post has no id or link' };

  const ownText = cleanPostText(raw.text ?? '');
  const original = raw.original;
  const originalText = original ? cleanPostText(original.text ?? '') : '';
  if (!ownText && !originalText) return { invalid: 'prepare: no-text' };

  // The record needs a title or description, and a share with only added text
  // must still reach Extract, so an original with no text falls back to it.
  const description = originalText || ownText;
  // Rules judge the original post, never the sharer.
  const judged = original ?? raw;
  const drop = firstDrop({
    text: original ? originalText : ownText,
    headline: judged.author.info,
    openToWorkCard: judged.openToWorkCard,
  });
  if (drop) return { invalid: `prepare: ${drop.rule}: "${drop.match}"` };

  const author = authorOf(raw.author);
  return emptyRecord({
    kind: 'post',
    descriptionText: description,
    postingUrl,
    postedAt: raw.postedAt,
    poster:
      author.name || author.profileUrl
        ? {
            name: author.name,
            profileUrl: author.profileUrl,
            type: author.type,
          }
        : null,
    post: postDetailOf(raw, raw.id, postingUrl, ownText, originalText),
  });
}
