import { DeleteProfileButton } from '@/components/preferences/delete-profile-button';
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
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-title-4 min-w-0 break-words">
          {labels[profileId] ?? 'Profile'}
        </h2>
        <DeleteProfileButton
          profileId={profileId}
          label={labels[profileId] ?? 'Profile'}
          isLast={items.length <= 1}
        />
      </div>
      {children}
    </div>
  );
}
