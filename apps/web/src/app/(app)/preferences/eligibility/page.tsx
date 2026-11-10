import { EligibilitySection } from '@/components/preferences/sections';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { loadEligibility } from '@/lib/setup/load';
import { saveEligibilityPrefsAction } from '../actions';
import { preferenceLists } from '../data';
import { requireSignedIn } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.eligibility) };

export default async function Page() {
  const { supabase } = await requireSignedIn();
  const [initial, lists] = await Promise.all([
    loadEligibility(supabase),
    preferenceLists(),
  ]);
  return (
    <EligibilitySection
      initial={initial}
      lists={{ countries: lists.countries, regions: lists.regions }}
      onSave={saveEligibilityPrefsAction}
    />
  );
}
