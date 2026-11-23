import { engineClient } from '@/lib/engine/server';
import { PausedNotice } from './paused-notice';

/**
 * Reads whether the user's searches are paused and renders the notice when they are. The
 * notice is advisory: any other result, or an engine that is down, renders nothing. Wrap
 * it in `Suspense`: a slow engine must not hold up Matches.
 */
export async function SearchesNotice() {
  try {
    const result = await (await engineClient()).searchesState();
    if (result.kind !== 'ok' || !result.data.paused) return null;
    const { lastActiveAt } = result.data;
    return (
      <PausedNotice
        lastActiveAt={lastActiveAt ? new Date(lastActiveAt) : null}
      />
    );
  } catch {
    return null;
  }
}
