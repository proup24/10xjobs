import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UserMenu } from './user-menu';

afterEach(cleanup);

const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }));

describe('UserMenu', () => {
  it('exposes Sign out as a menu item', async () => {
    render(<UserMenu />);
    open();
    const item = await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(item).toBeTruthy();
  });

  it('links an admin to the Prepare review', async () => {
    render(<UserMenu admin={Promise.resolve(true)} />);
    open();
    const item = await screen.findByRole('menuitem', {
      name: 'Admin: Prepare review',
    });
    expect(item.getAttribute('href')).toBe('/admin/prepare');
    const rescues = await screen.findByRole('menuitem', {
      name: 'Admin: Rescues',
    });
    expect(rescues.getAttribute('href')).toBe('/admin/rescues');
    const budget = await screen.findByRole('menuitem', {
      name: 'Admin: Posts budget',
    });
    expect(budget.getAttribute('href')).toBe('/admin/posts-budget');
  });

  it('hides the admin item from anyone else', async () => {
    render(<UserMenu admin={Promise.resolve(false)} />);
    open();
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(
      screen.queryByRole('menuitem', { name: 'Admin: Prepare review' }),
    ).toBeNull();
  });
});
