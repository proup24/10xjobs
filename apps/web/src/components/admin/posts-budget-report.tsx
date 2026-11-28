import type { PostsBudgetDayView, PostsBudgetView } from '@xjobs/engine-client';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Code } from '@/components/ui/text';
import { Note, Section } from './prepare-review';

const usd = (n: number) => `$${n.toFixed(2)}`;

/** UTC and fixed format, so server and browser render the same text. */
const at = (iso: string) => (
  <time dateTime={iso}>{`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}</time>
);

/** The Morocco calendar date a day starts on: fixed zone, so server and browser agree. */
const moroccoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Casablanca',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const moroccoDay = (iso: string) => (
  <time dateTime={iso}>{moroccoDate.format(new Date(iso))}</time>
);

type SearchRow = PostsBudgetView['searches'][number];

/**
 * A row key and, when one group split into several segments under one key, a label
 * telling the parts apart. An older engine sends no hash: rows are then keyed by position.
 */
function searchRows(searches: readonly SearchRow[]) {
  const total = new Map<string, number>();
  for (const s of searches) total.set(s.key, (total.get(s.key) ?? 0) + 1);
  const seen = new Map<string, number>();
  return searches.map((s, index) => {
    const n = (seen.get(s.key) ?? 0) + 1;
    seen.set(s.key, n);
    const part =
      (total.get(s.key) ?? 0) > 1
        ? `part ${n}${s.hash ? ` (${s.hash.slice(0, 8)})` : ''}`
        : null;
    return { search: s, rowKey: s.hash ?? `${index}|${s.key}`, part };
  });
}

const reached = (d: PostsBudgetDayView) =>
  d.reachedAt ? <>reached at {at(d.reachedAt)}</> : 'not reached';

/** Admin only: post search spend per day and how far behind each search is. */
export function PostsBudgetReport({ view }: { view: PostsBudgetView }) {
  const spent = (d: PostsBudgetDayView) =>
    `${usd(d.spentUsd)} of ${usd(view.limitUsd)}`;
  return (
    <div className="grid gap-8">
      <Section
        id="budget"
        title="Posts budget"
        description="LinkedIn post search spend against the daily limit (Morocco days)."
      >
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>{reached(view.today)}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-title-5">{spent(view.today)}</p>
            <Note>
              {view.pausedBuilders} paused builders (every owner paused for
              inactivity)
            </Note>
          </CardContent>
        </Card>
        <Table aria-label="Previous days">
          <TableHeader>
            <TableRow>
              <TableHead>Morocco day</TableHead>
              <TableHead>Spent</TableHead>
              <TableHead>Reached</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.days.map((d) => (
              <TableRow key={d.dayStart}>
                <TableCell>{moroccoDay(d.dayStart)}</TableCell>
                <TableCell>{spent(d)}</TableCell>
                <TableCell>{reached(d)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      <Section
        id="searches"
        title="Searches"
        description="Current post searches, most behind first."
      >
        {view.searches.length === 0 ? (
          <Note>none</Note>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Search</TableHead>
                <TableHead>Profiles</TableHead>
                <TableHead>Covered until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchRows(view.searches).map(({ search: s, rowKey, part }) => (
                <TableRow key={rowKey}>
                  <TableCell>
                    <Code>{s.key}</Code>
                    {part && (
                      <>
                        {' '}
                        <Badge variant="outline">{part}</Badge>
                      </>
                    )}
                  </TableCell>
                  <TableCell>{s.profiles}</TableCell>
                  <TableCell>
                    {s.oldestCoveredUntil ? (
                      at(s.oldestCoveredUntil)
                    ) : (
                      <Badge variant="secondary">never searched</Badge>
                    )}{' '}
                    {s.overDay && (
                      <Badge variant="destructive">over 24 hours behind</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section
        id="full-runs"
        title="Full runs"
        description="Runs of the last 7 days whose result came back full, per search."
      >
        {view.fullRuns.length === 0 ? (
          <Note>none</Note>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Search</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Last</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.fullRuns.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <Code>{r.key}</Code>
                  </TableCell>
                  <TableCell>{r.runs}</TableCell>
                  <TableCell>{at(r.lastAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
