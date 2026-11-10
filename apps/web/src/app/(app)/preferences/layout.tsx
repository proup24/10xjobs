import { PreferencesNav } from '@/components/preferences/preferences-nav';
import { requireSignedIn } from './guard';
import { preferenceProfiles } from './data';

export const dynamic = 'force-dynamic';

export default async function PreferencesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSignedIn();
  const { items, labels } = await preferenceProfiles();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title-3">Preferences</h1>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr] md:gap-10">
        <PreferencesNav
          items={items.map(({ id, hasResume }) => ({ id, hasResume }))}
          labels={labels}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
