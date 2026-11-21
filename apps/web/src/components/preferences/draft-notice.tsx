import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/** On a draft profile's pages: it is not live, and where to finish it. */
export function DraftNotice({ profileId }: { profileId: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        {"This profile isn't live yet. Finish setting it up to start matching."}
      </p>
      <Link
        href={`/preferences/new/${profileId}/resume`}
        className={buttonVariants({ variant: 'outline' })}
      >
        Finish setup
      </Link>
    </div>
  );
}
