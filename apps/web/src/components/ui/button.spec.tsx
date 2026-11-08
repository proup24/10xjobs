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

  const variants = [
    'default',
    'outline',
    'secondary',
    'dashed',
    'ghost',
    'destructive',
    'link',
  ] as const;

  it('every variant uses the solid focus outline, clear of the fill', () => {
    for (const variant of variants) {
      const classes = buttonVariants({ variant }).split(' ');
      for (const c of [
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-ring',
      ])
        expect(classes, variant).toContain(c);
      // outline-none/-hidden set the outline style to none and hide it.
      expect(classes, variant).not.toContain('outline-none');
      expect(classes, variant).not.toContain('outline-hidden');
      expect(
        classes.filter((c) => /^(dark:)?focus-visible:(ring|border)/.test(c)),
        variant,
      ).toEqual([]);
    }
  });

  it('primary hover is the solid primary-hover role, not an alpha', () => {
    const classes = buttonVariants({ variant: 'default' }).split(' ');
    expect(classes).toContain('hover:bg-primary-hover');
    expect(classes).not.toContain('hover:bg-primary/80');
  });

  it('destructive text uses the destructive-text role', () => {
    const classes = buttonVariants({ variant: 'destructive' }).split(' ');
    expect(classes).toContain('text-destructive-text');
    expect(classes).not.toContain('text-destructive');
  });

  it('link text uses the brand role', () => {
    const classes = buttonVariants({ variant: 'link' }).split(' ');
    expect(classes).toContain('text-brand');
    expect(classes).not.toContain('text-primary');
  });

  it('dashed uses the control border in both modes', () => {
    const classes = buttonVariants({ variant: 'dashed' }).split(' ');
    expect(classes).toContain('border-input');
    expect(classes).not.toContain('border-border');
  });
});
