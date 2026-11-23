'use server';

import { revalidatePath } from 'next/cache';
import { engineClient } from '@/lib/engine/server';

/**
 * Resumes the signed-in user's paused searches. The engine knows the user from the session
 * token; already running counts as success. A refusal or an unreachable engine is `ok: false`.
 */
export async function resumeSearchesAction(): Promise<{ ok: boolean }> {
  try {
    const result = await (await engineClient()).resumeSearches();
    if (result.kind !== 'ok') return { ok: false };
  } catch {
    return { ok: false };
  }
  revalidatePath('/');
  return { ok: true };
}
