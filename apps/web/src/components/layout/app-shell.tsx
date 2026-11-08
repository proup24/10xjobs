import { CircleUser } from 'lucide-react';
import { Brand } from '@/components/layout/brand';
import { AppNav } from '@/components/layout/app-nav';
import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-4">
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <AppNav />
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-4 md:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="User menu" />
                }
              >
                <CircleUser aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto p-2">
                <SignOutButton />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
