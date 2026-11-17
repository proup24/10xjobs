import { Channel } from 'src/common/enums';
import { normalizeConfig } from '../config';
import { atsIdentity } from '../utils/identity';
import { httpUrl, isLinkedinHost } from './linkedin';
import type { NormalizedRecord } from './record';

function isTracking(key: string): boolean {
  return normalizeConfig.trackingParams.some((rule) =>
    typeof rule === 'string' ? rule === key : rule.test(key),
  );
}

/**
 * The apply URL as an exact identity: lowercase host, no fragment, no trailing
 * slash, no tracking parameters, the other parameters sorted. Every other
 * parameter is kept, because it often carries the job id. Null when the value
 * is not an http(s) URL or points back at LinkedIn.
 */
export function canonicalApplyUrl(value: string): string | null {
  const url = httpUrl(value);
  if (!url || isLinkedinHost(url)) return null;
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTracking(key))
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1,
    );
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

/** `ats:<provider>/<tenant>/<posting>` when the URL names an Ashby or Greenhouse posting. */
function atsKey(value: string): string | null {
  let url = value;
  // Greenhouse also serves embedded application forms from app.greenhouse.io.
  const parsed = httpUrl(value);
  if (parsed?.hostname === 'app.greenhouse.io') {
    parsed.hostname = 'boards.greenhouse.io';
    url = parsed.toString();
  }
  try {
    const ats = atsIdentity(url);
    return ats ? `ats:${ats.provider}/${ats.tenantKey}/${ats.postingId}` : null;
  } catch {
    return null;
  }
}

function sourceId(sourceKey: string): string {
  return sourceKey.startsWith('id:') ? sourceKey.slice(3) : sourceKey;
}

/**
 * The job's real id, from exact facts only. An Ashby or Greenhouse item is its
 * posting. A LinkedIn job is the posting its apply URL names, else that URL
 * when it carries an identifier, else its own LinkedIn id. A post is always
 * its own: it may hold several jobs or none, so it never absorbs another.
 */
export function jobKey(
  channel: Channel,
  sourceKey: string,
  record: NormalizedRecord,
): string {
  switch (channel) {
    case Channel.ASHBY:
    case Channel.GREEN_HOUSE: {
      const provider = channel === Channel.ASHBY ? 'ashby' : 'greenhouse';
      return `ats:${provider}/${sourceKey.replace(/^posting:/, '')}`;
    }
    case Channel.LINKEDIN_POSTS:
      return `linkedin-post:${sourceId(sourceKey)}`;
    case Channel.LINKEDIN_JOB_BOARD: {
      const apply = record.applyUrl;
      if (apply) {
        const ats = atsKey(apply);
        if (ats) return ats;
        const canonical = canonicalApplyUrl(apply);
        if (canonical) {
          const { pathname, search } = new URL(canonical);
          if (normalizeConfig.identifierPattern.test(pathname + search))
            return `url:${canonical}`;
        }
      }
      return `linkedin-job:${sourceId(sourceKey)}`;
    }
  }
}

/** An `ats:` or `url:` key names the posting; a fallback key only the source item. */
export function isStrongJobKey(key: string): boolean {
  return key.startsWith('ats:') || key.startsWith('url:');
}
