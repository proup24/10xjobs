import { redirect } from 'next/navigation';
import { NewProfileTermsStep } from '@/components/preferences/new-profile-steps';
import { NEW_PROFILE_TITLE, preferencesTitle } from '@/lib/preferences/titles';
import { saveNewProfileTermsAction } from '../actions';
import { preferenceLists, preferenceNewProfileDraft } from '../../data';
import { requireSignedIn } from '../../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(NEW_PROFILE_TITLE) };

export default async function Page() {
  await requireSignedIn();
  const [draft, lists] = await Promise.all([
    preferenceNewProfileDraft(),
    preferenceLists(),
  ]);
  if (!draft) redirect('/preferences/new');
  // The profile is created from both steps' answers: the job comes first.
  if (!draft.job) redirect('/preferences/new/job');
  return (
    <NewProfileTermsStep
      initial={draft.terms ?? null}
      lists={{
        regions: lists.regions,
        countries: lists.countries,
        cities: lists.cities,
        contractTypes: lists.contractTypes,
        engagements: lists.engagements,
        currencies: lists.currencies,
      }}
      // Bound to the id this page rendered with, so a stale tab can't create another.
      onSave={saveNewProfileTermsAction.bind(null, draft.newProfileId)}
    />
  );
}
