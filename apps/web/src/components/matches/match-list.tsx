import type { MatchedJob } from '@/lib/matches/group';
import { MatchRowLink } from './match-row';

/** The jobs of the current tab and filters, newest posted first. */
export function MatchList({
  jobs,
  hrefFor,
  selectedJob,
  now,
  showProfiles,
  profileLabels,
  label = 'Matches',
}: {
  jobs: MatchedJob[];
  hrefFor: (jobId: string) => string;
  selectedJob: string | null;
  now: Date;
  showProfiles: boolean;
  profileLabels: Record<string, string>;
  /** The list's accessible name. */
  label?: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {jobs.map((job) => (
        <li key={job.jobId}>
          <MatchRowLink
            job={job}
            href={hrefFor(job.jobId)}
            selected={job.jobId === selectedJob}
            now={now}
            showProfiles={showProfiles}
            profileLabels={profileLabels}
          />
        </li>
      ))}
    </ul>
  );
}
