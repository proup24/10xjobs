import { TermsStep } from '@/components/setup/terms-step';
import { loadSetupProfile } from '@/lib/setup/load';
import { loadValueLists } from '@/lib/setup/value-lists';
import { requireSetupStep } from '../guard';
import { saveTermsAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { supabase, snapshot } = await requireSetupStep('terms');
  const [stored, lists] = await Promise.all([
    snapshot.profile
      ? loadSetupProfile(supabase, snapshot.profile.id)
      : Promise.resolve(null),
    loadValueLists(supabase),
  ]);
  const initial = snapshot.profile
    ? (stored?.terms ?? null)
    : (snapshot.draft?.terms ?? null);
  return (
    <TermsStep
      initial={initial}
      lists={{
        regions: lists.regions,
        countries: lists.countries,
        cities: lists.cities,
        contractTypes: lists.contractTypes,
        engagements: lists.engagements,
        currencies: lists.currencies,
      }}
      onSave={saveTermsAction}
    />
  );
}
