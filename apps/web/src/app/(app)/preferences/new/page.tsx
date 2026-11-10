import { InProgressChoice } from '@/components/preferences/new-profile-action';
import { StartChooser } from '@/components/preferences/start-chooser';
import { NEW_PROFILE_TITLE, preferencesTitle } from '@/lib/preferences/titles';
import { preferenceNewProfileDraft, preferenceProfiles } from '../data';
import { requireSignedIn } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(NEW_PROFILE_TITLE) };

const LEAD =
  'Start from a blank profile, or copy one of yours: its answers and its resume come along, and you can change any of them.';

export default async function Page() {
  await requireSignedIn();
  const [{ items, labels }, draft] = await Promise.all([
    preferenceProfiles(),
    preferenceNewProfileDraft(),
  ]);
  // A direct visit never silently replaces a draft: offer it first.
  if (draft) return <InProgressChoice />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-title-4">{NEW_PROFILE_TITLE}</h2>
        <p className="text-muted-foreground">{LEAD}</p>
      </div>
      <StartChooser
        profiles={items.map(({ id }) => ({
          id,
          label: labels[id] ?? 'Profile',
        }))}
      />
    </div>
  );
}
