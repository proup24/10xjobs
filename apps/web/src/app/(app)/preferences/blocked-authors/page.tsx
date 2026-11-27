import { BlockedAuthorsSection } from '@/components/preferences/blocked-authors-section';
import { loadBlockedAuthors } from '@/lib/preferences/blocked-authors';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { requireSignedIn } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: preferencesTitle(SECTION_TITLES.blockedAuthors),
};

export default async function Page() {
  const { supabase } = await requireSignedIn();
  const authors = await loadBlockedAuthors(supabase);
  return (
    <section
      aria-labelledby="blocked-authors-title"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h2 id="blocked-authors-title" className="text-title-4">
          {SECTION_TITLES.blockedAuthors}
        </h2>
        <p className="text-muted-foreground">
          Posts by these people and companies never match, and are never
          emailed.
        </p>
      </div>
      <BlockedAuthorsSection authors={authors} />
    </section>
  );
}
