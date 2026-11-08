import { EligibilityStep } from '@/components/setup/eligibility-step';
import { loadEligibility } from '@/lib/setup/load';
import { loadValueLists } from '@/lib/setup/value-lists';
import { requireSetupStep } from '../guard';
import { saveEligibilityAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { supabase } = await requireSetupStep('eligibility');
  const [initial, lists] = await Promise.all([
    loadEligibility(supabase),
    loadValueLists(supabase),
  ]);
  return (
    <EligibilityStep
      initial={initial}
      lists={{ countries: lists.countries, regions: lists.regions }}
      onSave={saveEligibilityAction}
    />
  );
}
