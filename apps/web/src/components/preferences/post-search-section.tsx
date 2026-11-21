import { engineClient } from '@/lib/engine/server';
import { PostSearchSwitch } from './post-search-switch';

/**
 * Loads the post search status and renders the switch for allow-listed users. Any other
 * result, or an engine that is down, renders nothing. Wrap it in `Suspense`: a slow
 * engine must not hold up the page.
 */
export async function PostSearchSection({ profileId }: { profileId: string }) {
  try {
    const result = await (await engineClient()).postSearchStatus(profileId);
    if (result.kind !== 'ok' || !result.data.allowed) return null;
    return <PostSearchSwitch profileId={profileId} initial={result.data} />;
  } catch {
    return null;
  }
}
