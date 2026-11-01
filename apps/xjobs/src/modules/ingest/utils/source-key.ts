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

const linkedinFields: Record<
  Channel.LINKEDIN_JOB_BOARD | Channel.LINKEDIN_POSTS,
  { ids: string[]; urls: string[] }
> = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    ids: ['id', 'jobId'],
    urls: ['jobUrl', 'url', 'link'],
  },
  [Channel.LINKEDIN_POSTS]: {
    ids: ['id'],
    urls: ['linkedinUrl', 'url', 'postUrl'],
  },
};

function linkedinKey(
  channel: Channel.LINKEDIN_JOB_BOARD | Channel.LINKEDIN_POSTS,
  item: Record<string, unknown>,
): SourceKeyResult {
  const fields = linkedinFields[channel];
  const id = firstText(item, fields.ids);
  if (id) return { key: `id:${id}` };
  if (channel === Channel.LINKEDIN_POSTS) {
    const urn = idText(item.urn);
    const activity = urn && /^urn:li:[a-zA-Z]+:(\d+)$/.exec(urn)?.[1];
    if (activity) return { key: `id:${activity}` };
  }
  const url = firstText(item, fields.urls);
  if (url) {
    const fromUrl = idFromLinkedinUrl(channel, url);
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
    case Channel.LINKEDIN_POSTS:
      return linkedinKey(channel, payload);
    case Channel.ASHBY:
    case Channel.GREEN_HOUSE:
      return postingKey(channel, payload);
  }
}
