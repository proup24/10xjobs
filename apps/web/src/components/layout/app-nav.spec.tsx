import { cleanup, render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppNav, NAV_ITEMS } from './app-nav';

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));

beforeAll(() => {
  // jsdom has no matchMedia; the sidebar provider reads it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const renderNav = () =>
  render(
    <SidebarProvider>
      <AppNav />
    </SidebarProvider>,
  );

afterEach(() => {
  cleanup();
  pathname.value = '/';
});

describe('AppNav', () => {
  it('marks the Home link as the current page at /', () => {
    renderNav();
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(home.getAttribute('href')).toBe('/');
  });

  it('marks no link as current on another path', () => {
    pathname.value = '/somewhere-else';
    renderNav();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('lists only routes that exist', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/']);
  });
});
