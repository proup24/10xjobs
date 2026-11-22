import { linkedinPostId, linkedinPostUrl } from '../../utils/source-key';
import { httpUrl } from '../linkedin';
import { cleanText, objectAt } from '../text';
import { linkedinJobId } from './clean';

type RawAuthor = {
  publicIdentifier: string | null;
  universalName: string | null;
  type: 'person' | 'company' | null;
  name: string | null;
  linkedinUrl: string | null;
  info: string | null;
};

/** A post as the actor returns it, every leaf trimmed text or null. */
type RawPostFields = {
  id: string | null;
  url: string | null;
  text: string | null;
  postedAt: string | null;
  author: RawAuthor;
  /** Links the payload carries outside the text. */
  linkUrls: string[];
  imageUrls: string[];
  /** LinkedIn's "<name> is open to work" card (`showcase`) is on the post. */
  openToWorkCard: boolean;
};

/** A post and the original it shares or reposts, read with the same fields. */
export type RawPost = RawPostFields & { original: RawPostFields | null };

const authorTypes: Record<string, RawAuthor['type']> = {
  profile: 'person',
  company: 'company',
};

function readAuthor(value: unknown): RawAuthor {
  const a = objectAt(value);
  const type = cleanText(a.type);
  return {
    publicIdentifier: cleanText(a.publicIdentifier),
    universalName: cleanText(a.universalName),
    type: type ? (authorTypes[type.toLowerCase()] ?? null) : null,
    name: cleanText(a.name),
    linkedinUrl: cleanText(a.linkedinUrl),
    info: cleanText(a.info),
  };
}

function isoDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * An attached LinkedIn job's link as `/jobs/view/<id>/`: its `refId` and
 * `trackingId` change on every scrape of the same post.
 */
function jobLink(value: unknown): string | null {
  const url = httpUrl(value);
  const id = url && linkedinJobId(url);
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : cleanText(value);
}

/** True for the open-to-work card the actor returns as `showcase`. */
function isOpenToWorkCard(value: unknown): boolean {
  return /\bopen to work\b/i.test(cleanText(objectAt(value).title) ?? '');
}

/** The fields of one post object: a top-level item or its nested original. */
function readPostFields(payload: Record<string, unknown>): RawPostFields {
  // `content` is kept as the actor sent it: cleaning may alter URL text.
  const content = typeof payload.content === 'string' ? payload.content : null;
  const images = Array.isArray(payload.postImages) ? payload.postImages : [];
  return {
    // Read as the source key reads them, so an item ingest keeps has both.
    id: linkedinPostId(payload),
    url: linkedinPostUrl(payload),
    text: content && content.trim() ? content : null,
    postedAt: isoDate(objectAt(payload.postedAt).date),
    author: readAuthor(payload.author),
    // The object's own attachments only: a share's original keeps its
    // `article`, `job` and images nested in `repost`, never at the top level.
    linkUrls: [
      cleanText(objectAt(payload.article).link),
      jobLink(objectAt(payload.job).linkedinUrl),
    ].filter((u): u is string => u !== null),
    imageUrls: images
      .map((i) => cleanText(typeof i === 'string' ? i : objectAt(i).url))
      .filter((u): u is string => u !== null),
    openToWorkCard: isOpenToWorkCard(payload.showcase),
  };
}

/**
 * The original a share or repost carries nested in `repost`, read as that
 * post scraped alone, whatever the outer text. Null when `repost` is missing,
 * not an object, or has neither an id nor text.
 */
export function readOriginal(
  payload: Record<string, unknown>,
): RawPost['original'] {
  const repost = objectAt(payload.repost);
  if (Object.keys(repost).length === 0) return null;
  const original = readPostFields(repost);
  return original.id || original.text ? original : null;
}

/** The only place that knows the actor's field names. */
export function readPostPayload(payload: Record<string, unknown>): RawPost {
  return { ...readPostFields(payload), original: readOriginal(payload) };
}
