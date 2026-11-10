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
  const { labels } = await preferenceProfiles();
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-title-4 break-words">
        {labels[profileId] ?? 'Profile'}
      </h2>
      {children}
    </div>
  );
}
