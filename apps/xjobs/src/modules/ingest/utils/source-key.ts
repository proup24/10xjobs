import { Channel } from 'src/common/enums';
import { atsIdentity, canonicalSource, webUrl } from './identity';

export type SourceKeyResult = { key: string } | { invalid: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A usable identifier: a non-blank string or number that is not a sentinel. */
function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
  return trimmed;
}

function firstText(
  item: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = idText(item[key]);
    if (value) return value;
  }
  return null;
}

/** Lowercase host, no fragment, no tracking parameters; null when not a web URL. */
function canonicalUrl(value: string): string | null {
  try {
    const url = webUrl(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|trk)/i.test(key) || key === 'gh_src' || key === 'refId')
        url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The posting/post id a LinkedIn URL names, when it names one. The actor
 * returns regional hosts (`de.linkedin.com`), which name the same posting.
 */
function idFromLinkedinUrl(channel: Channel, value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith('.linkedin.com'))
      url.hostname = 'www.linkedin.com';
    return canonicalSource(channel, url.toString()).sourceId;
  } catch {
    return null;
  }
}

type LinkedinKind = 'board' | 'posts';

const linkedinFields: Record<LinkedinKind, { ids: string[]; urls: string[] }> =
  {
    board: {
      ids: ['id', 'jobId'],
      urls: ['jobUrl', 'url', 'link'],
    },
    posts: {
      ids: ['id'],
      urls: ['linkedinUrl', 'url', 'postUrl'],
    },
  };

/** A LinkedIn post item's link: `linkedinUrl`, else `url`, else `postUrl`. */
export function linkedinPostUrl(item: Record<string, unknown>): string | null {
  return firstText(item, linkedinFields.posts.urls);
}

/**
 * A LinkedIn post item's id, as its source key reads it: `id` (a string or a
 * number), else the numeric id in its `urn`, else the id its link names.
 */
export function linkedinPostId(item: Record<string, unknown>): string | null {
  const id = firstText(item, linkedinFields.posts.ids);
  if (id) return id;
  const urn = idText(item.urn);
  const activity = urn && /^urn:li:[a-zA-Z]+:(\d+)$/.exec(urn)?.[1];
  if (activity) return activity;
  const url = linkedinPostUrl(item);
  return url ? idFromLinkedinUrl(Channel.LINKEDIN_POSTS, url) : null;
}

function linkedinKey(
  kind: LinkedinKind,
  item: Record<string, unknown>,
): SourceKeyResult {
  const fields = linkedinFields[kind];
  const id =
    kind === 'posts' ? linkedinPostId(item) : firstText(item, fields.ids);
  if (id) return { key: `id:${id}` };
  const url = firstText(item, fields.urls);
  if (url) {
    const fromUrl =
      kind === 'board'
        ? idFromLinkedinUrl(Channel.LINKEDIN_JOB_BOARD, url)
        : null;
    if (fromUrl) return { key: `id:${fromUrl}` };
    const canonical = canonicalUrl(url);
    if (canonical) return { key: `url:${canonical}` };
  }
  return { invalid: 'no source id or URL' };
}

/** Ashby and Greenhouse: the posting the Google hit names (or redirects to), whether or not it was fetched. */
function postingKey(
  channel: Channel.ASHBY | Channel.GREEN_HOUSE,
  item: Record<string, unknown>,
): SourceKeyResult {
  const hit = isObject(item.hit) ? item.hit : {};
  // A Google redirect hit carries the posting URL the collector resolved it to.
  const url = idText(item.resolvedUrl) ?? idText(hit.url);
  if (!url) return { invalid: 'no source id or URL' };
  let ats: ReturnType<typeof atsIdentity> = null;
  try {
    ats = atsIdentity(url);
  } catch {
    ats = null;
  }
  const provider = channel === Channel.ASHBY ? 'ashby' : 'greenhouse';
  if (!ats || ats.provider !== provider)
    return { invalid: 'not a posting URL' };
  return { key: `posting:${ats.tenantKey}/${ats.postingId}` };
}

/**
 * The identity of one collected payload within its channel. Exact only: the
 * source's own id, else its canonical URL; never title or company.
 */
export function sourceKey(channel: Channel, payload: unknown): SourceKeyResult {
  if (!isObject(payload)) return { invalid: 'payload is not a JSON object' };
  switch (channel) {
    case Channel.LINKEDIN_JOB_BOARD:
    case Channel.LINKEDIN_JOB_BOARD_CHEAP:
    case Channel.LINKEDIN_JOB_BOARD_BEBITY:
      return linkedinKey('board', payload);
    case Channel.LINKEDIN_POSTS:
      return linkedinKey('posts', payload);
    case Channel.ASHBY:
    case Channel.GREEN_HOUSE:
      return postingKey(channel, payload);
    case Channel.INDEED: {
      const jobKey = idText(payload.key);
      return jobKey
        ? { key: `jk:${jobKey}` }
        : { invalid: 'no Indeed job key' };
    }
  }
}
