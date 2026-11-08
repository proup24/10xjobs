import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechAnswer } from '@/lib/setup/answers';
import { TechRows } from './tech-rows';

afterEach(cleanup);

const OPTIONS = [
  { value: 'postgresql', label: 'PostgreSQL', searchable: true },
  { value: 'react', label: 'React', searchable: true },
  { value: 'typescript', label: 'TypeScript', searchable: true },
  { value: 'saas', label: 'SaaS', searchable: false },
];

const tech = (code: string, patch: Partial<TechAnswer> = {}): TechAnswer => ({
  code,
  rating: 3,
  starred: false,
  ...patch,
});

function setup(value: TechAnswer[], errors: Record<string, string> = {}) {
  const onChange = vi.fn();
  render(
    <TechRows
      value={value}
      onChange={onChange}
      options={OPTIONS}
      errors={errors}
    />,
  );
  return { onChange };
}

const star = (label: string) =>
  screen.getByRole('button', { name: `Search for ${label}` });

/** The text an element's aria-describedby points at. */
const description = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('TechRows', () => {
  it('shows each tech by label with its rating ends and a remove button', () => {
    const { onChange } = setup([tech('postgresql')]);
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
    expect(screen.getByText('1 = learning')).toBeTruthy();
    expect(screen.getByText('5 = expert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove PostgreSQL' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('rating a tech reports the rating', () => {
    const { onChange } = setup([tech('postgresql', { rating: null })]);
    const group = screen.getByRole('radiogroup', {
      name: 'PostgreSQL mastery',
    });
    fireEvent.click(
      Array.from(group.querySelectorAll('[role="radio"]'))[3] as HTMLElement,
    );
    expect(onChange).toHaveBeenCalledWith([tech('postgresql', { rating: 4 })]);
  });

  it('pressing the star stars the tech, filled when pressed', () => {
    const { onChange } = setup([tech('postgresql'), tech('react')]);
    fireEvent.click(star('PostgreSQL'));
    expect(onChange).toHaveBeenCalledWith([
      tech('postgresql', { starred: true }),
      tech('react'),
    ]);
    cleanup();
    setup([tech('postgresql', { starred: true })]);
    expect(star('PostgreSQL').getAttribute('aria-pressed')).toBe('true');
    expect(star('PostgreSQL').querySelector('svg')?.classList).toContain(
      'fill-current',
    );
  });

  it('a third star is disabled with the hint "Up to two techs can drive search"', () => {
    setup([
      tech('postgresql', { starred: true }),
      tech('react', { starred: true }),
      tech('typescript'),
    ]);
    const third = star('TypeScript') as HTMLButtonElement;
    expect(third.disabled).toBe(true);
    expect(description(third)).toBe('Up to two techs can drive search');
    // The starred ones can still be turned off.
    expect((star('PostgreSQL') as HTMLButtonElement).disabled).toBe(false);
    // The hint stays reachable from the keyboard through its wrapper.
    expect(third.parentElement?.getAttribute('tabindex')).toBe('0');
  });

  it('focusing the blocked wrapper opens the hint tooltip', async () => {
    setup([
      tech('postgresql', { starred: true }),
      tech('react', { starred: true }),
      tech('typescript'),
    ]);
    fireEvent.focus(star('TypeScript').parentElement as HTMLElement);
    const tips = await screen.findAllByText('Up to two techs can drive search');
    // The screen reader text, plus the visible tooltip.
    expect(tips.length).toBe(2);
  });

  it('the star is disabled on a non-searchable tech', () => {
    setup([tech('saas')]);
    const button = star('SaaS') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(description(button)).toBe('We can’t search for this tech');
  });

  it('a starred tech that is not searchable can still be unstarred', () => {
    const { onChange } = setup([tech('saas', { starred: true })]);
    fireEvent.click(star('SaaS'));
    expect(onChange).toHaveBeenCalledWith([tech('saas')]);
  });

  it('an enabled star has no wrapper tab stop', () => {
    setup([tech('postgresql')]);
    expect(star('PostgreSQL').parentElement?.getAttribute('tabindex')).toBe(
      null,
    );
  });

  it('a rating error is shown on its row', () => {
    setup([tech('postgresql', { rating: null })], {
      'techs.0.rating': 'Rate PostgreSQL',
    });
    expect(screen.getByText('Rate PostgreSQL')).toBeTruthy();
    expect(
      screen
        .getByRole('radiogroup', { name: 'PostgreSQL mastery' })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });
});
