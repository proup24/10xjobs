import { ResumeSection } from '@/components/preferences/sections';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { loadResume } from '@/lib/setup/load';
import { requireOwnProfile } from '../../../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.resume) };

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { supabase, userId, profileId } = await requireOwnProfile(
    (await params).profileId,
  );
  const current = await loadResume(supabase, profileId);
  return (
    <ResumeSection profileId={profileId} userId={userId} current={current} />
  );
}
