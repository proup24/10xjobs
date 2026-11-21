export const APPLY_NOTE =
  'Changes apply to the next searches and to jobs from the last 30 days.';
export const APPLYING_NOTE =
  'Your last change is being applied to the searches.';

/** On the job and terms pages of a published profile: when edits take effect. */
export function PublishedNotice({ applying }: { applying: boolean }) {
  return (
    <div aria-live="polite" className="space-y-1 text-sm text-muted-foreground">
      <p>{APPLY_NOTE}</p>
      {applying && <p>{APPLYING_NOTE}</p>}
    </div>
  );
}
