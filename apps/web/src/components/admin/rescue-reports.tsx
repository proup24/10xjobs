import type { RescueView } from '@xjobs/engine-client';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Code } from '@/components/ui/text';
import { Note, OpenPost, Section, day } from './prepare-review';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the system said when the user rescued the post, read defensively. */
function said(rescue: RescueView): React.ReactNode {
  const snapshot = isRecord(rescue.snapshot) ? rescue.snapshot : {};
  if (rescue.origin === 'junk') {
    const verdict = isRecord(snapshot.verdict) ? snapshot.verdict : null;
    if (!verdict) return '—';
    return (
      <span>
        <Code>{String(verdict.value ?? '')}</Code>{' '}
        {typeof verdict.reason === 'string' ? verdict.reason : ''}
      </span>
    );
  }
  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
  const reasons = profiles.flatMap((p): string[] =>
    isRecord(p) && Array.isArray(p.failed)
      ? p.failed.flatMap((c) =>
          isRecord(c) && typeof c.reason === 'string' ? [c.reason] : [],
        )
      : [],
  );
  if (reasons.length === 0) return '—';
  return (
    <ul className="grid gap-0.5">
      {reasons.map((reason, i) => (
        <li key={i}>{reason}</li>
      ))}
    </ul>
  );
}

/** Admin only: every user's rescues, newest first. Null items means the engine failed. */
export function RescueReports({ items }: { items: RescueView[] | null }) {
  return (
    <div className="grid gap-8">
      <Section
        id="rescues"
        title="Rescues"
        description="Posts users rescued from Junk or Disqualified, newest first, with what the system said at the time."
      >
        {items === null ? (
          <Note>Couldn&apos;t load rescues.</Note>
        ) : items.length === 0 ? (
          <Note>No rescues yet.</Note>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>The system said</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Post</TableHead>
                <TableHead>
                  <span className="sr-only">Status</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{day(r.createdAt)}</TableCell>
                  <TableCell>
                    <Code>{r.origin}</Code>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal break-words">
                    {said(r)}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal break-words">
                    {r.note ?? '—'}
                  </TableCell>
                  <TableCell>
                    <OpenPost url={r.job.postingUrl} />
                  </TableCell>
                  <TableCell>
                    {r.undoneAt && <Badge variant="secondary">Undone</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
