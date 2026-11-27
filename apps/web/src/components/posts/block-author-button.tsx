'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  blockAuthorAction,
  unblockAuthorAction,
} from '@/app/(app)/preferences/actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { SaveResult } from '@/lib/setup/save-result';

const failed = (result?: SaveResult) =>
  toast.error(
    result?.status === 'invalid' && result.errors._form
      ? result.errors._form
      : "Couldn't save. Try again.",
  );

/** Blocks a post's author or sharer after a confirmation; their posts move to Disqualified. */
export function BlockAuthorButton({
  authorKey,
  name,
  profileUrl,
}: {
  authorKey: string;
  name: string;
  profileUrl: string | null;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Block ${name}?`}
      description="Their posts move to Disqualified within a few minutes, and are never emailed."
      confirmLabel="Block"
      onConfirm={async () => {
        let result: SaveResult;
        try {
          result = await blockAuthorAction({
            authorKey,
            name,
            ...(profileUrl ? { profileUrl } : {}),
          });
        } catch {
          failed();
          return;
        }
        if (result.status === 'saved') {
          toast.success(`Blocked ${name}`);
          router.refresh();
        } else failed(result);
      }}
      trigger={
        <Button variant="outline" size="sm" aria-label={`Block ${name}`}>
          Block
        </Button>
      }
    />
  );
}

/** Unblocks an author whose post was disqualified for being blocked. */
export function UnblockAuthorButton({
  authorKey,
  name,
}: {
  authorKey: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function unblock() {
    setBusy(true);
    try {
      const result = await unblockAuthorAction(authorKey);
      if (result.status === 'saved') router.refresh();
      else failed(result);
    } catch {
      failed();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" loading={busy} onClick={() => void unblock()}>
      {`Unblock ${name}`}
    </Button>
  );
}
