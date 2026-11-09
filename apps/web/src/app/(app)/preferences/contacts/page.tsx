import { ContactsSection } from '@/components/preferences/sections';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { loadAbout } from '@/lib/setup/load';
import { saveContactsAction } from '../actions';
import { requireSignedIn } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.contacts) };

export default async function Page() {
  const { supabase } = await requireSignedIn();
  const { email, answers } = await loadAbout(supabase);
  return (
    <ContactsSection
      email={email}
      initial={answers}
      onSave={saveContactsAction}
    />
  );
}
