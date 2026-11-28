import { createHash } from 'node:crypto';
import { Channel, isTrialChannel } from 'src/common/enums';
import { normalizeConfig } from '../config';
import { atsIdentity } from '../utils/identity';
import { httpUrl, isLinkedinHost } from './linkedin';
import { comparableText } from './posts/clean';
import type { NormalizedRecord } from './record';

/** Shortest comparable text, in characters, that identifies a post by its content. */
const MIN_POST_TEXT = 100;

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

/** `ats:…` for an Ashby or Greenhouse posting, else `url:<canonical>` when the URL carries an identifier. */
function applyUrlKey(value: string): string | null {
  const ats = atsKey(value);
  if (ats) return ats;
  const canonical = canonicalApplyUrl(value);
  if (!canonical) return null;
  const { pathname, search } = new URL(canonical);
  return normalizeConfig.identifierPattern.test(pathname + search)
    ? `url:${canonical}`
    : null;
}

const LINKEDIN_JOB_VIEW = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/;

/**
 * The job keys a post role's apply links resolve to, sorted and unique: a
 * LinkedIn `/jobs/view/<id>` link is `linkedin-job:<id>`, any other link is
 * keyed as `jobKey` keys an apply URL (`ats:…`, or `url:…` with an
 * identifier). A link that names no job is dropped.
 */
export function linkKeysOf(links: string[]): string[] {
  const keys = new Set<string>();
  for (const link of links) {
    const url = httpUrl(link);
    const id =
      url && isLinkedinHost(url)
        ? LINKEDIN_JOB_VIEW.exec(url.pathname)?.[1]
        : undefined;
    const key = id ? `linkedin-job:${id}` : applyUrlKey(link);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

function sourceId(sourceKey: string): string {
  return /^(?:id|jk):/.test(sourceKey) ? sourceKey.slice(3) : sourceKey;
}

/**
 * `linkedin-post:text:<fingerprint>` for an original with at least 100
 * comparable characters, a known author and a text the actor did not cut at
 * "see more"; else `linkedin-post:<original id, else the post's own id>`. The
 * fingerprint covers the author, the text and any links attached outside the
 * text (sorted, once each). A share is judged by the post it shares: its own
 * text, truncation and attachments never count.
 */
export function postJobKey(
  sourceKey: string,
  record: NormalizedRecord,
): string {
  const post = record.post;
  const original = post?.original ?? null;
  const from = original ?? post;
  const authorKey = original ? original.author?.key : post?.author.key;
  const text = comparableText(from?.text ?? '');
  // `??`: a record stored before these fields existed has no key at all.
  const truncated = from?.truncated ?? false;
  if (authorKey && text.length >= MIN_POST_TEXT && !truncated) {
    const attached = [...new Set(from?.attachedUrls ?? [])].sort();
    const input = [`${authorKey}\n${text}`, ...attached].join('\n');
    const digest = createHash('sha256')
      .update(input)
      .digest('hex')
      .slice(0, 32);
    return `linkedin-post:text:${digest}`;
  }
  return `linkedin-post:${original?.id ?? sourceId(sourceKey)}`;
}

/**
 * The job's real id, from exact facts only. An Ashby or Greenhouse item is its
 * posting. A LinkedIn job is the posting its apply URL names, else that URL
 * when it carries an identifier, else its own LinkedIn id. An Indeed job is
 * keyed the same way (so it joins harvestapi's job for the same link), else by
 * its own `indeed-job:<key>`. A trial actor's
 * item is always its LinkedIn id. A post is keyed by its original's text (with
 * its attached links) when that text is long enough, whole and its author is
 * known (the same original shared or reposted is one job, exact matches only),
 * else by the original's id, else by its own id: it may hold several jobs or
 * none, so it never absorbs another on a guess.
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
      return postJobKey(sourceKey, record);
    case Channel.LINKEDIN_JOB_BOARD:
    case Channel.LINKEDIN_JOB_BOARD_CHEAP:
    case Channel.LINKEDIN_JOB_BOARD_BEBITY: {
      // A trial actor never names the posting by its apply URL: it always
      // keys by LinkedIn id so it joins harvestapi's job later.
      if (isTrialChannel(channel)) return `linkedin-job:${sourceId(sourceKey)}`;
      const apply = record.applyUrl;
      const key = apply ? applyUrlKey(apply) : null;
      if (key) return key;
      return `linkedin-job:${sourceId(sourceKey)}`;
    }
    case Channel.INDEED: {
      const apply = record.applyUrl;
      return (
        (apply ? applyUrlKey(apply) : null) ??
        `indeed-job:${sourceId(sourceKey)}`
      );
    }
  }
}

/** An `ats:` or `url:` key names the posting; a fallback key only the source item. */
export function isStrongJobKey(key: string): boolean {
  return key.startsWith('ats:') || key.startsWith('url:');
}
