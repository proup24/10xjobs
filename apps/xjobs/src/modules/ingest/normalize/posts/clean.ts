import { atsIdentity } from '../../utils/identity';

/** The links a post carries, sorted by what the mapper can do with them. */
export type PostLinks = {
  emails: string[];
  linkedinJobIds: string[];
  atsPostings: { provider: 'ashby' | 'greenhouse'; url: string }[];
  other: string[];
};

const EMOJI =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE00}-\u{FE0F}]|\u{200D}|\u{20E3}|[\u{1F3FB}-\u{1F3FF}]/gu;
const SEE_MORE_TAIL = /\s*(?:…|\.{3})\s*(?:see\s+)?more\s*$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Plain post text for reading and matching: no emoji, hashtag or mention
 * marks, no "see more" tail, one blank line at most between paragraphs.
 */
export function cleanPostText(raw: string): string {
  return raw
    .replace(EMOJI, '')
    .replace(/hashtag#/gi, '')
    .replace(/(^|[^\p{L}\p{N}_/&?=:.-])#(?=[\p{L}\p{N}])/gu, '$1')
    .replace(/(^|\s)@(?=\p{L})/gu, '$1')
    .replace(SEE_MORE_TAIL, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text for comparing posts: accents removed, lowercase, words split by one space. */
export function comparableText(clean: string): string {
  return clean
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Drops trailing punctuation, keeping a `)` that closes a `(` in the URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1) ?? '';
    const open = url.split('(').length - 1;
    const close = url.split(')').length - 1;
    if (/[.,;:!?…\]”’»"']/.test(last) || (last === ')' && close > open))
      url = url.slice(0, -1);
    else return url;
  }
}

function linkedinJobId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const view = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)/.exec(url.pathname);
  return (
    view?.[1] ??
    /^\d+$/.exec(url.searchParams.get('currentJobId') ?? '')?.[0] ??
    null
  );
}

/** Sorts the emails and URLs found in the text and the post's own links. */
export function sortLinks(text: string, urls: readonly string[]): PostLinks {
  const found = [...text.matchAll(URL_RE)].map((m) => m[0]);
  const all = [...found, ...urls].map(trimUrl);
  const emails = (text.replace(URL_RE, ' ').match(EMAIL_RE) ?? []).map((e) =>
    e.toLowerCase(),
  );

  const linkedinJobIds = new Set<string>();
  const ats = new Map<
    string,
    { provider: 'ashby' | 'greenhouse'; url: string }
  >();
  const other = new Set<string>();
  for (const raw of all) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const jobId = linkedinJobId(url);
    if (jobId) {
      linkedinJobIds.add(jobId);
      continue;
    }
    let identity: ReturnType<typeof atsIdentity> = null;
    try {
      identity = atsIdentity(raw);
    } catch {
      // Unsupported shape (port, credentials): an ordinary link.
    }
    if (identity) ats.set(raw, { provider: identity.provider, url: raw });
    else other.add(raw);
  }
  return {
    emails: [...new Set(emails)],
    linkedinJobIds: [...linkedinJobIds],
    atsPostings: [...ats.values()],
    other: [...other],
  };
}
