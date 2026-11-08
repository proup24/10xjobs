'use client';

import { Briefcase, Home } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { Block } from './block';

export function SidebarSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Sidebar</h2>
      <Block title="Sidebar menu: active item, then hover or focus an item">
        <div className="h-56 overflow-hidden rounded-lg border border-border">
          <SidebarProvider className="min-h-0">
            <Sidebar collapsible="none">
              <SidebarHeader className="px-4 py-3">Sample</SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive render={<a href="#home" />}>
                        <Home aria-hidden />
                        <span>Active item</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton render={<a href="#jobs" />}>
                        <Briefcase aria-hidden />
                        <span>Other item</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
          </SidebarProvider>
        </div>
      </Block>
    </section>
  );
}
