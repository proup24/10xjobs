import { notFound } from 'next/navigation';
import { RescueReports } from '@/components/admin/rescue-reports';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { engineClient } from '@/lib/engine/server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rescues · 10xjobs' };

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
          <EmptyTitle>Rescues</EmptyTitle>
          <EmptyDescription>
            Couldn&apos;t reach the engine; try again.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (me.kind !== 'ok' || !me.data.admin) notFound();

  const rescues = await engine.adminRescues();
  return (
    <RescueReports items={rescues.kind === 'ok' ? rescues.data.items : null} />
  );
}
