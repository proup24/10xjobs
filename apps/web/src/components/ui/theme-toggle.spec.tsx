import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from './theme-toggle';

beforeAll(() => {
  // jsdom has no matchMedia; next-themes may call it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

describe('ThemeToggle', () => {
  it('starts dark and switches to light', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true));
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('honours a stored light choice on load', async () => {
    localStorage.setItem('theme', 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(await screen.findByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });
});
