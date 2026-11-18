'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text';
import { channelBadges } from '@/lib/matches/sources';
import { timeAgo } from '@/lib/matches/freshness';
import type { JobPosting } from '@/lib/matches/postings';

/** "Merged · 2 postings" beside the title; nothing for a single posting. */
export function MergedBadge({ postings }: { postings: JobPosting[] }) {
  if (postings.length < 2) return null;
  return (
    <Badge variant="secondary">{`Merged · ${postings.length} postings`}</Badge>
  );
}

/** What differs from the posting shown above, as marks. */
function marks(p: JobPosting): string[] {
  return [
    p.shown ? 'shown above' : null,
    p.titleDiffers ? 'title differs' : null,
    p.placeDiffers ? 'place differs' : null,
    p.descriptionDiffers ? 'description differs' : null,
  ].filter((m): m is string => m !== null);
}

/** The postings that share this job's apply link, collapsed until asked for. */
export function JobPostings({
  postings,
  now,
}: {
  postings: JobPosting[];
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (postings.length < 2) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-2">
      <Button
        variant="ghost"
        className="w-fit max-w-full justify-start"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <Chevron aria-hidden />
        {`${postings.length} postings share this apply link`}
      </Button>
      <ul id={listId} hidden={!open} className="flex flex-col gap-3">
        {open &&
          postings.map((p) => {
            const details = [
              p.location,
              p.postedAt
                ? `posted ${timeAgo(new Date(p.postedAt), now)}`
                : null,
            ].filter(Boolean);
            return (
              <li key={p.rawItemId} className="flex min-w-0 flex-col gap-1">
                <span className="break-words">{p.title ?? 'Untitled'}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  {details.length > 0 && <span>{details.join(' · ')}</span>}
                  {p.postingUrl && (
                    <TextLink
                      href={p.postingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View on LinkedIn
                    </TextLink>
                  )}
                  {p.channel && (
                    <Badge variant="outline">
                      {channelBadges([p.channel])[0]}
                    </Badge>
                  )}
                  {marks(p).map((m) => (
                    <Badge key={m} variant="secondary">
                      {m}
                    </Badge>
                  ))}
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
