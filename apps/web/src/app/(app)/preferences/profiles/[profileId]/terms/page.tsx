import { notFound } from 'next/navigation';
import { TermsSection } from '@/components/preferences/sections';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { loadSetupProfile } from '@/lib/setup/load';
import { saveProfileTermsAction } from '../../../actions';
import { preferenceLists } from '../../../data';
import { requireOwnProfile } from '../../../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.terms) };

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { supabase, profileId } = await requireOwnProfile(
    (await params).profileId,
  );
  const [stored, lists] = await Promise.all([
    loadSetupProfile(supabase, profileId),
    preferenceLists(),
  ]);
  if (!stored) notFound();
  return (
    <TermsSection
      initial={stored.terms}
      lists={{
        regions: lists.regions,
        countries: lists.countries,
        cities: lists.cities,
        contractTypes: lists.contractTypes,
        engagements: lists.engagements,
        currencies: lists.currencies,
      }}
      onSave={saveProfileTermsAction.bind(null, profileId)}
    />
  );
}
