import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';
import type { ProfileListItem } from '@/lib/preferences/profiles';
import { PreferencesNav } from './preferences-nav';

const pathname = vi.hoisted(() => ({ value: '/preferences/contacts' }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push }),
}));
vi.mock('@/app/(app)/preferences/new/actions', () => ({
  discardNewProfileAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  pathname.value = '/preferences/contacts';
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ITEMS: ProfileListItem[] = [
  {
    id: A,
    position: 'backend_engineer',
    firstPlace: null,
    hasResume: true,
    state: 'published',
  },
  {
    id: B,
    position: 'backend_engineer',
    firstPlace: null,
    hasResume: false,
    state: 'published',
  },
];
const LABELS = {
  [A]: 'Backend engineer · Berlin',
  [B]: 'Backend engineer · Paris',
};

function MakeDirty() {
  const { setDirty } = useUnsavedChanges();
  return (
    <button type="button" onClick={() => setDirty(true)}>
      make dirty
    </button>
  );
}

function renderNav() {
  return render(
    <UnsavedChangesProvider>
      <PreferencesNav items={ITEMS} labels={LABELS} draftInProgress={false} />
      <MakeDirty />
    </UnsavedChangesProvider>,
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Preferences' });
const link = (name: string | RegExp) =>
  within(nav()).getByRole('link', { name });

describe('PreferencesNav', () => {
  it('has the You and Profiles groups', () => {
    renderNav();
    expect(within(nav()).getByRole('group', { name: 'You' })).toBeTruthy();
    expect(within(nav()).getByRole('group', { name: 'Profiles' })).toBeTruthy();
    expect(link('Contacts').getAttribute('href')).toBe('/preferences/contacts');
    expect(link('Where you can work').getAttribute('href')).toBe(
      '/preferences/eligibility',
    );
  });

  it('the Profiles group has "New profile", in the side column and the phone block', () => {
    renderNav();
    const links = screen.getAllByRole('link', { name: 'New profile' });
    expect(links).toHaveLength(2);
    for (const l of links)
      expect(l.getAttribute('href')).toBe('/preferences/new');
    expect(
      within(nav()).getByRole('link', { name: 'New profile' }),
    ).toBeTruthy();
  });

  it('marks the current section', () => {
    renderNav();
    expect(link('Contacts').getAttribute('aria-current')).toBe('page');
    expect(link('Where you can work').getAttribute('aria-current')).toBeNull();
  });

  it('a profile without a resume shows "Needs a resume" and links to its resume', () => {
    renderNav();
    const withResume = link(/Berlin/);
    expect(withResume.getAttribute('href')).toBe(
      `/preferences/profiles/${A}/job`,
    );
    expect(withResume.textContent).not.toContain('Needs a resume');
    const without = link(/Paris/);
    expect(without.textContent).toContain('Needs a resume');
    expect(without.getAttribute('href')).toBe(
      `/preferences/profiles/${B}/resume`,
    );
  });

  it('shows the sections only under the current profile, with the current one marked', () => {
    pathname.value = `/preferences/profiles/${A}/terms`;
    renderNav();
    const terms = link('Location and terms');
    expect(terms.getAttribute('href')).toBe(`/preferences/profiles/${A}/terms`);
    expect(terms.getAttribute('aria-current')).toBe('page');
    expect(link('The job you want').getAttribute('href')).toBe(
      `/preferences/profiles/${A}/job`,
    );
    expect(link('Resume').getAttribute('href')).toBe(
      `/preferences/profiles/${A}/resume`,
    );
    // One set of children: none under the other profile.
    expect(within(nav()).getAllByRole('link', { name: 'Resume' })).toHaveLength(
      1,
    );
    // The profile item isn't also marked current.
    expect(link(/Berlin/).getAttribute('aria-current')).toBeNull();
  });

  it('a selected profile without a resume has no duplicate link targets', () => {
    pathname.value = `/preferences/profiles/${B}/job`;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderNav();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    fireEvent.click(screen.getByRole('combobox', { name: 'Preferences' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(new Set(options).size).toBe(options.length);
    expect(options).toContain('Backend engineer · Paris: Resume');
  });

  it('no profile sections while on a You page', () => {
    renderNav();
    expect(within(nav()).queryByRole('link', { name: 'Resume' })).toBeNull();
  });

  it('navigates at once when clean', () => {
    renderNav();
    fireEvent.click(link('Where you can work'));
    expect(push).toHaveBeenCalledWith('/preferences/eligibility');
  });

  it('a click while dirty opens the discard dialog, and Discard goes on', () => {
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    fireEvent.click(link('Where you can work'));
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(push).toHaveBeenCalledWith('/preferences/eligibility');
  });

  it('clicking the link you are already on does nothing, even when dirty', () => {
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    expect(fireEvent.click(link('Contacts'))).toBe(false);
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('lets modified and middle clicks through untouched even when dirty', () => {
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    const target = link('Where you can work');
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      // fireEvent returns false when preventDefault was called.
      expect(fireEvent.click(target, init)).toBe(true);
    }
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
