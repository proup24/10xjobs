import { redirect } from 'next/navigation';
import { NewProfileJobStep } from '@/components/preferences/new-profile-steps';
import { NEW_PROFILE_TITLE, preferencesTitle } from '@/lib/preferences/titles';
import { saveNewProfileJobAction } from '../actions';
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
  return (
    <NewProfileJobStep
      initial={draft.job ?? null}
      lists={{
        positions: lists.positions,
        seniorities: lists.seniorities,
        techs: lists.techs,
        languages: lists.languages,
      }}
      onSave={saveNewProfileJobAction}
    />
  );
}
