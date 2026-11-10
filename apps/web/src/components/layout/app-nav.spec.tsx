import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppNav, NAV_ITEMS } from './app-nav';
import { UnsavedChangesProvider, useUnsavedChanges } from './unsaved-changes';

const pathname = vi.hoisted(() => ({ value: '/' }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push }),
}));

beforeAll(() => {
  // jsdom has no matchMedia; the sidebar provider reads it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

function MakeDirty() {
  const { setDirty } = useUnsavedChanges();
  return <button onClick={() => setDirty(true)}>make dirty</button>;
}

const renderNav = () =>
  render(
    <UnsavedChangesProvider>
      <SidebarProvider>
        <AppNav />
        <MakeDirty />
      </SidebarProvider>
    </UnsavedChangesProvider>,
  );

afterEach(() => {
  cleanup();
  push.mockClear();
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
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/', '/preferences']);
  });

  it('marks Preferences current on any page under /preferences', () => {
    pathname.value = '/preferences/profiles/abc/job';
    renderNav();
    const prefs = screen.getByRole('link', { name: 'Preferences' });
    expect(prefs.getAttribute('aria-current')).toBe('page');
    expect(prefs.getAttribute('href')).toBe('/preferences');
    expect(
      screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('does not mark Preferences on a path that only shares its prefix', () => {
    pathname.value = '/preferencesx';
    renderNav();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('navigates at once when clean', () => {
    pathname.value = '/preferences';
    renderNav();
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('asks before navigating when dirty, and goes on Discard', () => {
    pathname.value = '/preferences';
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('clicking the link you are already on does nothing, even when dirty', () => {
    pathname.value = '/';
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    expect(fireEvent.click(screen.getByRole('link', { name: 'Home' }))).toBe(
      false,
    );
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('lets modified clicks through untouched even when dirty', () => {
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    const link = screen.getByRole('link', { name: 'Home' });
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      // fireEvent returns false when preventDefault was called.
      expect(fireEvent.click(link, init)).toBe(true);
    }
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
