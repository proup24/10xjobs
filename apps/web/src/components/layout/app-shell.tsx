import { Brand } from '@/components/layout/brand';
import { AppNav } from '@/components/layout/app-nav';
import { UnsavedChangesProvider } from '@/components/layout/unsaved-changes';
import { UserMenu } from '@/components/layout/user-menu';
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

export function AppShell({
  children,
  admin,
}: {
  children: React.ReactNode;
  /** Resolves to whether the user is an admin; the user menu shows admin pages then. */
  admin?: Promise<boolean>;
}) {
  return (
    <UnsavedChangesProvider>
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
              <UserMenu admin={admin} />
            </div>
          </header>
          <div className="flex-1 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </UnsavedChangesProvider>
  );
}
