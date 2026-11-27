import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from '@/lib/resume/errors';
import { loadError } from '@/lib/setup/load';
import {
  FAILED,
  SAVED,
  logger,
  type Deps,
  type SaveResult,
} from '@/lib/setup/save-result';

type Client = SupabaseClient<Database>;

export type BlockedAuthor = {
  authorKey: string;
  name: string | null;
  profileUrl: string | null;
  createdAt: string;
};

export const INVALID_LINK = 'Paste a LinkedIn profile or company link.';

/**
 * The silence key and canonical link of a pasted LinkedIn profile or company link, or
 * null. The key is the one ingest builds (`profile:<publicIdentifier>`,
 * `company:<universalName>`, lowercased), which is the slug in the link.
 */
export function parseAuthorLink(
  input: string,
): { authorKey: string; profileUrl: string } | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const [first, raw] = url.pathname.split('/').filter(Boolean);
  const kind = first?.toLowerCase();
  if ((kind !== 'in' && kind !== 'company') || !raw) return null;
  let id: string;
  try {
    id = decodeURIComponent(raw).toLowerCase();
  } catch {
    return null;
  }
  if (!id) return null;
  const prefix = kind === 'in' ? 'profile' : 'company';
  return {
    authorKey: `${prefix}:${id}`,
    profileUrl: `https://www.linkedin.com/${kind}/${raw}/`,
  };
}

/** The user's blocked authors, newest first (RLS limits the read to their own). */
export async function loadBlockedAuthors(
  supabase: Client,
): Promise<BlockedAuthor[]> {
  const r = await supabase
    .from('blocked_authors')
    .select('authorKey, name, profileUrl, createdAt')
    .order('createdAt', { ascending: false });
  if (r.error) throw loadError('blocked authors read', r.error);
  return (r.data ?? []).map((row) => ({
    authorKey: row.authorKey,
    name: row.name,
    profileUrl: row.profileUrl,
    createdAt: row.createdAt,
  }));
}

const invalid = (message: string): SaveResult => ({
  status: 'invalid',
  errors: { _form: message },
});

const text = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;

/** A stored link is shown as a link only when it is an https URL. */
const httpsUrl = (v: unknown) => {
  const s = text(v);
  return s && s.startsWith('https://') ? s : null;
};

const KEY = /^(profile|company):\S+$/;

/** Blocks one author: from a pasted link, or from a key a post already carries. A duplicate counts as saved. */
export async function blockAuthor(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  if (typeof input !== 'object' || input === null) return invalid(INVALID_LINK);
  const i = input as Record<string, unknown>;
  let row: {
    authorKey: string;
    name: string | null;
    profileUrl: string | null;
  };
  if (typeof i.link === 'string') {
    const parsed = parseAuthorLink(i.link);
    if (!parsed) return invalid(INVALID_LINK);
    row = { ...parsed, name: null };
  } else if (typeof i.authorKey === 'string' && KEY.test(i.authorKey.trim())) {
    row = {
      authorKey: i.authorKey.trim().toLowerCase(),
      name: text(i.name),
      profileUrl: httpsUrl(i.profileUrl),
    };
  } else return invalid(INVALID_LINK);

  const r = await supabase.from('blocked_authors').insert({ userId, ...row });
  if (!r.error || r.error.code === '23505') return SAVED;
  log(`blocked authors: insert code=${errorCode(r.error)}`);
  return FAILED;
}

/** Unblocks one author by key, under RLS (another user's row matches nothing). */
export async function unblockAuthor(
  supabase: Client,
  authorKey: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  if (typeof authorKey !== 'string' || !authorKey) return FAILED;
  const r = await supabase
    .from('blocked_authors')
    .delete()
    .eq('authorKey', authorKey.toLowerCase());
  if (r.error) {
    log(`blocked authors: delete code=${errorCode(r.error)}`);
    return FAILED;
  }
  return SAVED;
}
