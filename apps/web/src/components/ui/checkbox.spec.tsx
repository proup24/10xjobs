import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from './checkbox';

afterEach(cleanup);

describe('Checkbox', () => {
  it('flips aria-checked and reports the change on click', () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Remember" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole('checkbox', { name: 'Remember' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(onCheckedChange.mock.calls[0][0]).toBe(true);
  });
});
