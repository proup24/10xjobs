'use client';

import { CircleUser } from 'lucide-react';
import Link from 'next/link';
import { Suspense, use, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Shown once the engine says the user is an admin; nothing while it is asked. */
function AdminItem({ admin }: { admin: Promise<boolean> }) {
  if (!use(admin)) return null;
  return (
    <>
      <DropdownMenuItem render={<Link href="/admin/prepare" />}>
        Admin: Prepare review
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link href="/admin/rescues" />}>
        Admin: Rescues
      </DropdownMenuItem>
    </>
  );
}

/**
 * `admin` is a promise so the shell does not wait on the engine: the item appears when
 * it resolves to true.
 */
export function UserMenu({ admin }: { admin?: Promise<boolean> }) {
  const form = useRef<HTMLFormElement>(null);

  return (
    <>
      {/* The form lives outside the popup; the menu item submits it. */}
      <form ref={form} method="post" action="/auth/sign-out" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="User menu" />}
        >
          <CircleUser aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          {admin && (
            <Suspense fallback={null}>
              <AdminItem admin={admin} />
            </Suspense>
          )}
          <DropdownMenuItem onClick={() => form.current?.requestSubmit()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
