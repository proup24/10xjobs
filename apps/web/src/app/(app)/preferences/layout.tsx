import { PreferencesNav } from '@/components/preferences/preferences-nav';
import { requireSignedIn } from './guard';
import { preferenceNewProfileDraft, preferenceProfiles } from './data';

export const dynamic = 'force-dynamic';

export default async function PreferencesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSignedIn();
  const [{ items, labels }, draft] = await Promise.all([
    preferenceProfiles(),
    preferenceNewProfileDraft(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title-3">Preferences</h1>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr] md:gap-10">
        <PreferencesNav
          items={items.map(({ id, hasResume, state }) => ({
            id,
            hasResume,
            state,
          }))}
          labels={labels}
          draftInProgress={draft !== null}
        />
        <div className="min-w-0 max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
