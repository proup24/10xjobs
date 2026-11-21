import { linkedinPostId, linkedinPostUrl } from '../../utils/source-key';
import { cleanText, objectAt } from '../text';

type RawAuthor = {
  publicIdentifier: string | null;
  universalName: string | null;
  type: 'person' | 'company' | null;
  name: string | null;
  linkedinUrl: string | null;
  info: string | null;
};

type RawOriginal = {
  id: string | null;
  url: string | null;
  text: string | null;
  postedAt: string | null;
  author: RawAuthor;
};

/** A post as the actor returns it, every leaf trimmed text or null. */
export type RawPost = {
  id: string | null;
  url: string | null;
  text: string | null;
  postedAt: string | null;
  author: RawAuthor;
  /** Links the payload carries outside the text. */
  linkUrls: string[];
  imageUrls: string[];
  original: RawOriginal | null;
};

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

/** The shared original of a repost; null until its real shape is known. */
export function readOriginal(
  _payload: Record<string, unknown>,
): RawPost['original'] {
  return null;
}

/** The only place that knows the actor's field names. */
export function readPostPayload(payload: Record<string, unknown>): RawPost {
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
    linkUrls: [cleanText(objectAt(payload.article).link)].filter(
      (u): u is string => u !== null,
    ),
    imageUrls: images
      .map((i) => cleanText(typeof i === 'string' ? i : objectAt(i).url))
      .filter((u): u is string => u !== null),
    original: readOriginal(payload),
  };
}
