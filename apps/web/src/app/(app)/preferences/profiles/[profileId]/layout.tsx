import { DeleteProfileButton } from '@/components/preferences/delete-profile-button';
import { PostSearchSwitch } from '@/components/preferences/post-search-switch';
import { engineClient } from '@/lib/engine/server';
import { requireOwnProfile } from '../../guard';
import { preferenceProfiles } from '../../data';

export const dynamic = 'force-dynamic';

export default async function ProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await requireOwnProfile((await params).profileId);
  const { items, labels } = await preferenceProfiles();
  const mine = items.find((i) => i.id === profileId);
  const blockedReason =
    items.length <= 1
      ? 'last'
      : mine?.hasResume && !items.some((i) => i.id !== profileId && i.hasResume)
        ? 'only-resume'
        : null;
  let postSearch: Awaited<
    ReturnType<Awaited<ReturnType<typeof engineClient>>['postSearchStatus']>
  > = { kind: 'unavailable' };
  try {
    postSearch = await (await engineClient()).postSearchStatus(profileId);
  } catch {
    // The switch is optional: the page renders without it.
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-title-4 min-w-0 break-words">
          {labels[profileId] ?? 'Profile'}
        </h2>
        <DeleteProfileButton
          profileId={profileId}
          label={labels[profileId] ?? 'Profile'}
          blockedReason={blockedReason}
        />
      </div>
      {postSearch.kind === 'ok' && postSearch.data.allowed && (
        <PostSearchSwitch profileId={profileId} initial={postSearch.data} />
      )}
      {children}
    </div>
  );
}
