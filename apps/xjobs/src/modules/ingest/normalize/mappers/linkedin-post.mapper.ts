import type { NormalizeContext } from '../normalize';
import { httpUrl } from '../linkedin';
import { cleanPostText, sortLinks } from '../posts/clean';
import { readPostPayload, type RawPost } from '../posts/payload';
import { firstDrop } from '../posts/rules';
import { emptyRecord, type NormalizedRecord, type PostAuthor } from '../record';

const link = (value: string | null) =>
  value ? (httpUrl(value)?.toString() ?? null) : null;

function authorOf(a: RawPost['author']): PostAuthor {
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
  const drop = firstDrop({
    text: original ? originalText : ownText,
    headline: original ? original.author.info : raw.author.info,
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
    post: {
      id: raw.id,
      url: postingUrl,
      author,
      text: ownText || null,
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
            postedAt: original.postedAt,
          }
        : null,
      links: sortLinks(
        [raw.text ?? '', original?.text ?? ''].join('\n'),
        raw.linkUrls,
      ),
    },
  });
}
