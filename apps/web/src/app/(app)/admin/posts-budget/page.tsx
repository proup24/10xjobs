import { notFound } from 'next/navigation';
import { Note } from '@/components/admin/prepare-review';
import { PostsBudgetReport } from '@/components/admin/posts-budget-report';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { engineClient } from '@/lib/engine/server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Posts budget · 10xjobs' };

/**
 * Admin only: anyone the engine does not count as an admin (`ADMIN_USERS`) gets a 404.
 * An unreachable engine shows only a retry note. The engine checks every call again.
 */
export default async function Page() {
  const engine = await engineClient();
  const me = await engine.adminMe();
  if (me.kind === 'unavailable')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Posts budget</EmptyTitle>
          <EmptyDescription>
            Couldn&apos;t reach the engine; try again.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (me.kind !== 'ok' || !me.data.admin) notFound();

  const budget = await engine.adminPostsBudget();
  if (budget.kind !== 'ok')
    return <Note>Couldn&apos;t load the posts budget.</Note>;
  return <PostsBudgetReport view={budget.data} />;
}
