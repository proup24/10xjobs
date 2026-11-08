import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('loading disables the button and marks it busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: /save/i });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('maps kit sizes to heights', () => {
    for (const [size, h] of [
      ['xs', 'h-7'],
      ['sm', 'h-8'],
      ['default', 'h-9'],
      ['lg', 'h-10'],
      ['xl', 'h-12'],
    ] as const)
      expect(buttonVariants({ size })).toContain(h);
  });

  it('icon sizes are square and distinct', () => {
    expect(buttonVariants({ size: 'icon-xs' })).toContain('size-7');
    expect(buttonVariants({ size: 'icon' })).toContain('size-9');
    expect(buttonVariants({ size: 'icon-lg' })).toContain('size-10');
    expect(buttonVariants({ size: 'icon-xl' })).toContain('size-12');
  });

  it('dashed uses a dashed border', () => {
    expect(buttonVariants({ variant: 'dashed' })).toContain('border-dashed');
  });
});
