import { notFound } from 'next/navigation';
import type { EngineResult } from '@xjobs/engine-client';
import {
  LISTED_VERDICTS,
  POST_VERDICT_REASONS,
  type ListedVerdict,
} from '@xjobs/database/enums';
import { ExtractVerdicts } from '@/components/admin/extract-verdicts';
import {
  PREPARE_REVIEW_PATH,
  PrepareReview,
} from '@/components/admin/prepare-review';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { engineClient } from '@/lib/engine/server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Prepare review · 10xjobs' };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

const dataOf = <T,>(result: EngineResult<T>): T | null =>
  result.kind === 'ok' ? result.data : null;

const verdictOf = (v: string | undefined): ListedVerdict | undefined =>
  LISTED_VERDICTS.find((x) => x === v);

const reasonOf = (v: string | undefined): string | undefined =>
  POST_VERDICT_REASONS.find((x) => x === v);

function href(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value);
  return `${PREPARE_REVIEW_PATH}?${query.toString()}`;
}

/**
 * Admin only: anyone the engine does not count as an admin (`ADMIN_USERS`) gets a 404,
 * so the page does not reveal that it exists. An unreachable engine shows only a retry
 * note. The engine checks every call again.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const engine = await engineClient();
  const me = await engine.adminMe();
  // Engine down: say so rather than 404. Nothing admin is fetched or shown.
  if (me.kind === 'unavailable')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Prepare review</EmptyTitle>
          <EmptyDescription>
            Couldn&apos;t reach the engine; try again.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (me.kind !== 'ok' || !me.data.admin) notFound();

  const sp = await searchParams;
  const rule = first(sp.rule);
  const before = first(sp.before);
  const heldBefore = first(sp.held);
  // An unknown verdict or reason is ignored rather than sent for a 400.
  const verdict = verdictOf(first(sp.verdict));
  const reason = reasonOf(first(sp.reason));
  const verdictsBefore = first(sp.verdicts);

  const [drops, held, verdicts, authors, candidates] = await Promise.all([
    engine.prepareDrops({
      ...(rule ? { rule } : {}),
      ...(before ? { before } : {}),
    }),
    engine.silencedPosts(heldBefore ? { before: heldBefore } : {}),
    engine.extractVerdicts({
      ...(verdict ? { verdict } : {}),
      ...(reason ? { reason } : {}),
      ...(verdictsBefore ? { before: verdictsBefore } : {}),
    }),
    engine.silencedAuthors(),
    engine.autoSilenceCandidates(),
  ]);
  const dropsPage = dataOf(drops);
  const heldPage = dataOf(held);
  const verdictsPage = dataOf(verdicts);
  const authorList = dataOf(authors);
  // Every section's next link keeps the filters and the other sections' cursors.
  const state = {
    rule,
    before,
    held: heldBefore,
    verdict,
    reason,
    verdicts: verdictsBefore,
  };

  return (
    <PrepareReview
      rule={rule ?? null}
      drops={dropsPage}
      held={heldPage}
      authors={authorList}
      nextDropsHref={
        dropsPage?.next ? href({ ...state, before: dropsPage.next }) : null
      }
      nextHeldHref={
        heldPage?.next ? href({ ...state, held: heldPage.next }) : null
      }
      verdicts={
        <ExtractVerdicts
          verdict={verdict ?? null}
          reason={reason ?? null}
          page={verdictsPage}
          silenced={new Set((authorList ?? []).map((a) => a.authorKey))}
          candidates={dataOf(candidates)}
          nextHref={
            verdictsPage?.next
              ? href({ ...state, verdicts: verdictsPage.next })
              : null
          }
        />
      }
    />
  );
}
