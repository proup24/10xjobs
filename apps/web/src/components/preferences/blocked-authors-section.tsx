'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  blockAuthorAction,
  unblockAuthorAction,
} from '@/app/(app)/preferences/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TextLink } from '@/components/ui/text';
import type { BlockedAuthor } from '@/lib/preferences/blocked-authors';

const date = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The blocked authors: a link field to add one, and the list with Unblock. */
export function BlockedAuthorsSection({
  authors,
}: {
  authors: BlockedAuthor[];
}) {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(
    id: string,
    action: () => ReturnType<typeof blockAuthorAction>,
    onSaved?: () => void,
  ) {
    setBusy(id);
    try {
      const r = await action();
      if (r.status === 'saved') {
        onSaved?.();
        router.refresh();
      } else if (r.status === 'invalid') {
        setError(r.errors._form ?? "Couldn't save. Try again.");
      } else notifySaveFailed();
    } catch {
      notifySaveFailed();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void run(
            'block',
            () => blockAuthorAction({ link }),
            () => setLink(''),
          );
        }}
      >
        <Field invalid={error !== null}>
          <FieldLabel htmlFor="blocked-author-link">LinkedIn link</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="blocked-author-link"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.linkedin.com/in/…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError(null);
              }}
            />
            <Button type="submit" loading={busy === 'block'}>
              Block
            </Button>
          </div>
          <FieldError>{error}</FieldError>
        </Field>
      </form>

      {authors.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {authors.map((a) => {
            const label = a.name ?? a.authorKey;
            return (
              <li
                key={a.authorKey}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
              >
                <span className="min-w-0 flex-1 break-words font-medium">
                  {label}
                </span>
                {a.profileUrl?.startsWith('https://') && (
                  <TextLink
                    href={a.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 break-all"
                  >
                    LinkedIn
                  </TextLink>
                )}
                <time
                  dateTime={a.createdAt}
                  className="shrink-0 text-muted-foreground"
                >
                  {date(a.createdAt)}
                </time>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Unblock ${label}`}
                  loading={busy === a.authorKey}
                  onClick={() =>
                    void run(a.authorKey, () =>
                      unblockAuthorAction(a.authorKey),
                    )
                  }
                >
                  Unblock
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
