import type { JobPosting } from './postings';
import { HARVEST_CHANNEL, isLinkedinJobBoard } from './sources';

/** One posting as shown: the copies every LinkedIn job-board actor made of it, as one. */
export type PostingGroup = JobPosting & { channels: string[] };

/**
 * The postings as shown. Every LinkedIn job-board actor's copy of one LinkedIn
 * job (same posting URL, built from the LinkedIn id) is one posting, showing
 * harvestapi's fields, with each actor's channel. Other postings stay one each,
 * in the order given.
 */
export function groupPostings(postings: JobPosting[]): PostingGroup[] {
  const groups: JobPosting[][] = [];
  const byUrl = new Map<string, JobPosting[]>();
  for (const p of postings) {
    const key =
      p.channel && isLinkedinJobBoard(p.channel) ? p.postingUrl : null;
    const group = key ? byUrl.get(key) : undefined;
    if (group) {
      group.push(p);
      continue;
    }
    const fresh = [p];
    if (key) byUrl.set(key, fresh);
    groups.push(fresh);
  }
  return groups.map((members) => {
    const lead =
      members.find((m) => m.channel === HARVEST_CHANNEL) ?? members[0];
    // The shown posting differs from nothing: it is the one shown above.
    const shown = members.some((m) => m.shown);
    return {
      ...lead,
      shown,
      titleDiffers: !shown && lead.titleDiffers,
      placeDiffers: !shown && lead.placeDiffers,
      descriptionDiffers: !shown && lead.descriptionDiffers,
      channels: members.flatMap((m) => (m.channel ? [m.channel] : [])),
    };
  });
}
