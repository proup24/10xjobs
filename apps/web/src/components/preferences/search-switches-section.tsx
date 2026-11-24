import { engineClient } from '@/lib/engine/server';
import { SearchSwitch } from './search-switch';

/**
 * Loads the profile's search switches and renders one per item. Any non-ok result, an
 * empty list, or an engine that is down (or too old to have the route) renders nothing.
 * Wrap it in `Suspense`: a slow engine must not hold up the page.
 */
export async function SearchSwitchesSection({
  profileId,
}: {
  profileId: string;
}) {
  try {
    const result = await (await engineClient()).searchSwitches(profileId);
    if (result.kind !== 'ok' || result.data.length === 0) return null;
    return (
      <>
        {result.data.map((view) => (
          <SearchSwitch key={view.key} profileId={profileId} view={view} />
        ))}
      </>
    );
  } catch {
    return null;
  }
}
