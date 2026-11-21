'use server';

import { revalidatePath } from 'next/cache';
import { engineClient } from '@/lib/engine/server';

type Outcome = 'saved' | 'failed';

/** The engine's own pattern: an author key is `profile:…` or `company:…`. */
const AUTHOR_KEY = /^(profile|company):.+/;
const MAX_KEY = 300;
const MAX_NAME = 300;
const MAX_REASON = 1000;

const PAGE = '/admin/prepare';

const isAuthorKey = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_KEY && AUTHOR_KEY.test(v);

/**
 * Silences a post author, with a reason. The engine checks that the caller is an admin
 * (403 otherwise) and records who silenced. An author already silenced counts as saved.
 */
export async function silenceAuthorAction(input: unknown): Promise<Outcome> {
  if (typeof input !== 'object' || input === null) return 'failed';
  const { authorKey, name, reason } = input as Record<string, unknown>;
  if (!isAuthorKey(authorKey)) return 'failed';
  if (name !== undefined && name !== null && typeof name !== 'string')
    return 'failed';
  if (typeof reason !== 'string') return 'failed';
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > MAX_REASON) return 'failed';
  try {
    const result = await (
      await engineClient()
    ).silenceAuthor({
      authorKey,
      name: typeof name === 'string' && name ? name.slice(0, MAX_NAME) : null,
      reason: trimmed,
    });
    if (result.kind !== 'ok') return 'failed';
  } catch {
    return 'failed';
  }
  revalidatePath(PAGE);
  return 'saved';
}

/** Un-silences a post author. One no longer silenced (404) counts as saved. */
export async function unsilenceAuthorAction(
  authorKey: unknown,
): Promise<Outcome> {
  if (!isAuthorKey(authorKey)) return 'failed';
  try {
    const result = await (await engineClient()).unsilenceAuthor(authorKey);
    if (result.kind !== 'ok' && result.kind !== 'not-found') return 'failed';
  } catch {
    return 'failed';
  }
  revalidatePath(PAGE);
  return 'saved';
}
