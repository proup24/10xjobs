'use client';

import { CircleUser } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu() {
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
          <DropdownMenuItem onClick={() => form.current?.requestSubmit()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
