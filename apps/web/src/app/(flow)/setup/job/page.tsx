import { setupStepTitle } from '@/lib/setup/steps';
import { JobStep } from '@/components/setup/job-step';
import { loadSetupProfile } from '@/lib/setup/load';
import { loadValueLists } from '@/lib/setup/value-lists';
import { requireSetupStep } from '../guard';
import { saveJobAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: setupStepTitle('job') };

export default async function Page() {
  const { supabase, snapshot } = await requireSetupStep('job');
  const [stored, lists] = await Promise.all([
    snapshot.profile
      ? loadSetupProfile(supabase, snapshot.profile.id)
      : Promise.resolve(null),
    loadValueLists(supabase),
  ]);
  const initial = snapshot.profile
    ? (stored?.job ?? null)
    : (snapshot.draft?.job ?? null);
  return (
    <JobStep
      initial={initial}
      lists={{
        positions: lists.positions,
        seniorities: lists.seniorities,
        techs: lists.techs,
        languages: lists.languages,
      }}
      onSave={saveJobAction}
    />
  );
}
