import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerticalNav, type VerticalNavGroup } from './vertical-nav';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());
afterEach(cleanup);

const groups: VerticalNavGroup[] = [
  {
    label: 'You',
    items: [
      { href: '/preferences/about', label: 'About you', current: true },
      { href: '/preferences/contacts', label: 'Contacts' },
    ],
  },
  {
    label: 'Profiles',
    items: [
      {
        href: '/preferences/p1',
        label: 'Backend',
        badge: 'Draft',
        children: [{ href: '/preferences/p1/roles', label: 'Roles' }],
      },
      { href: '/preferences/p2', label: 'Frontend' },
    ],
    action: <button type="button">New profile</button>,
  },
];

const nav = () => screen.getByRole('navigation', { name: 'Preferences' });
const links = () =>
  Array.from(nav().querySelectorAll('a')).map((a) => a.textContent);

describe('VerticalNav', () => {
  it('renders group headings and links in a labelled nav', () => {
    render(<VerticalNav groups={groups} label="Preferences" />);
    expect(nav().textContent).toContain('You');
    expect(nav().textContent).toContain('Profiles');
    expect(
      screen.getByRole('link', { name: 'Contacts' }).getAttribute('href'),
    ).toBe('/preferences/contacts');
  });

  it('marks only the current item with aria-current="page"', () => {
    render(<VerticalNav groups={groups} label="Preferences" />);
    const current = nav().querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('About you');
  });

  it('renders children after their parent', () => {
    render(<VerticalNav groups={groups} label="Preferences" />);
    const text = links().map((t) => t?.replace(/Draft$/, ''));
    expect(text.indexOf('Roles')).toBe(text.indexOf('Backend') + 1);
  });

  it('shows a badge and the group action', () => {
    render(<VerticalNav groups={groups} label="Preferences" />);
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'New profile' }).length,
    ).toBeGreaterThan(0);
  });

  it('onNavigate receives the href and the event; preventDefault is honoured', () => {
    const onNavigate = vi.fn((_href: string, e: { preventDefault(): void }) =>
      e.preventDefault(),
    );
    render(
      <VerticalNav
        groups={groups}
        label="Preferences"
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole('link', { name: 'Contacts' });
    const notPrevented = fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0]).toBe('/preferences/contacts');
    expect(notPrevented).toBe(false);
  });

  it('link clicks are not prevented without onNavigate', () => {
    render(<VerticalNav groups={groups} label="Preferences" />);
    expect(
      fireEvent.click(screen.getByRole('link', { name: 'Contacts' })),
    ).toBe(true);
  });

  describe('phone select', () => {
    const choose = (name: string) => {
      fireEvent.click(screen.getByRole('combobox'));
      const option = screen.getByRole('option', { name });
      fireEvent.pointerDown(option);
      fireEvent.mouseDown(option);
      fireEvent.pointerUp(option);
      fireEvent.mouseUp(option);
      fireEvent.click(option);
    };

    it('lists every item, children prefixed with their parent', () => {
      render(<VerticalNav groups={groups} label="Preferences" />);
      fireEvent.click(screen.getByRole('combobox'));
      const names = screen.getAllByRole('option').map((o) => o.textContent);
      expect(names).toEqual([
        'About you',
        'Contacts',
        'Backend',
        'Backend: Roles',
        'Frontend',
      ]);
    });

    it('navigates on change when not prevented', () => {
      const onNavigate = vi.fn();
      render(
        <VerticalNav
          groups={groups}
          label="Preferences"
          onNavigate={onNavigate}
        />,
      );
      choose('Contacts');
      expect(onNavigate).toHaveBeenCalledWith(
        '/preferences/contacts',
        expect.objectContaining({ preventDefault: expect.any(Function) }),
      );
      expect(push).toHaveBeenCalledWith('/preferences/contacts');
    });

    it('does not navigate when onNavigate prevents the change', () => {
      const onNavigate = vi.fn((_h: string, e: { preventDefault(): void }) =>
        e.preventDefault(),
      );
      render(
        <VerticalNav
          groups={groups}
          label="Preferences"
          onNavigate={onNavigate}
        />,
      );
      choose('Contacts');
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    });
  });
});
