'use client';

import { Home, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  opensElsewhere,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';

// Only routes that exist belong here.
export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/preferences', label: 'Preferences', icon: SlidersHorizontal },
];

/** Home only at `/`; any other item for its own path and everything under it. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { confirmLeave } = useUnsavedChanges();

  return (
    <SidebarMenu>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              isActive={active}
              render={
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => {
                    // Modified and non-primary clicks open a new tab and lose
                    // nothing, so they go through untouched.
                    if (opensElsewhere(event)) return;
                    event.preventDefault();
                    // Already here: nothing to leave, nothing to ask.
                    if (href === pathname) return;
                    confirmLeave(() => {
                      setOpenMobile(false);
                      router.push(href);
                    });
                  }}
                />
              }
            >
              <Icon aria-hidden />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
