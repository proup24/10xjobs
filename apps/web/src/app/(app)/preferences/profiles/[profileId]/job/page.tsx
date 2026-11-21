import { notFound } from 'next/navigation';
import { JobSection } from '@/components/preferences/sections';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { PublishedNotice } from '@/components/preferences/published-notice';
import { loadProfileSync, loadSetupProfile } from '@/lib/setup/load';
import { saveProfileJobAction } from '../../../actions';
import { preferenceLists } from '../../../data';
import { requireOwnProfile } from '../../../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.job) };

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { supabase, profileId } = await requireOwnProfile(
    (await params).profileId,
  );
  const [stored, sync, lists] = await Promise.all([
    loadSetupProfile(supabase, profileId),
    loadProfileSync(supabase, profileId),
    preferenceLists(),
  ]);
  if (!stored) notFound();
  return (
    <>
      {sync?.published && <PublishedNotice applying={sync.applying} />}
      <JobSection
        initial={stored.job}
        lists={{
          positions: lists.positions,
          seniorities: lists.seniorities,
          techs: lists.techs,
          languages: lists.languages,
        }}
        onSave={saveProfileJobAction.bind(null, profileId)}
      />
    </>
  );
}
