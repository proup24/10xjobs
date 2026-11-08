import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UserMenu } from './user-menu';

afterEach(cleanup);

describe('UserMenu', () => {
  it('exposes Sign out as a menu item', async () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    const item = await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(item).toBeTruthy();
  });
});
