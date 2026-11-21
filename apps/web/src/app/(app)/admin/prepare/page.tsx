import { notFound } from 'next/navigation';
import type { EngineResult } from '@xjobs/engine-client';
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

  const [drops, held, authors] = await Promise.all([
    engine.prepareDrops({
      ...(rule ? { rule } : {}),
      ...(before ? { before } : {}),
    }),
    engine.silencedPosts(heldBefore ? { before: heldBefore } : {}),
    engine.silencedAuthors(),
  ]);
  const dropsPage = dataOf(drops);
  const heldPage = dataOf(held);

  return (
    <PrepareReview
      rule={rule ?? null}
      drops={dropsPage}
      held={heldPage}
      authors={dataOf(authors)}
      // Each section's next link keeps the filter and the other section's cursor.
      nextDropsHref={
        dropsPage?.next
          ? href({ rule, before: dropsPage.next, held: heldBefore })
          : null
      }
      nextHeldHref={
        heldPage?.next ? href({ rule, before, held: heldPage.next }) : null
      }
    />
  );
}
