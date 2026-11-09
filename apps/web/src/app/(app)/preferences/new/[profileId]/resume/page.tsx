import { NewProfileResumeStep } from '@/components/preferences/new-profile-steps';
import { NEW_PROFILE_TITLE, preferencesTitle } from '@/lib/preferences/titles';
import { loadResume } from '@/lib/setup/load';
import { requireOwnProfile } from '../../../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(NEW_PROFILE_TITLE) };

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { supabase, userId, profileId } = await requireOwnProfile(
    (await params).profileId,
  );
  // A copy's resume is already here, so it shows with Replace.
  const current = await loadResume(supabase, profileId);
  return (
    <NewProfileResumeStep
      profileId={profileId}
      userId={userId}
      current={current}
    />
  );
}
