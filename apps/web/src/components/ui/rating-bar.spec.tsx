import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Field, FieldDescription, FieldError } from './field';
import { RatingBar } from './rating-bar';

afterEach(cleanup);

describe('RatingBar', () => {
  it('renders five radios with none checked when value is null', () => {
    render(
      <RatingBar value={null} onValueChange={vi.fn()} aria-label="Mastery" />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Mastery' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(
      radios.map((r) => r.getAttribute('aria-label') ?? r.textContent),
    ).toEqual(['1', '2', '3', '4', '5']);
    for (const r of radios)
      expect(r.getAttribute('aria-checked')).toBe('false');
  });

  it('click selects and calls onValueChange(4)', () => {
    const onValueChange = vi.fn();
    render(
      <RatingBar
        value={null}
        onValueChange={onValueChange}
        aria-label="Mastery"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toBe(4);
  });

  it('ArrowRight from 3 selects 4', async () => {
    const onValueChange = vi.fn();
    render(
      <RatingBar
        value={3}
        onValueChange={onValueChange}
        aria-label="Mastery"
      />,
    );
    const three = screen.getByRole('radio', { name: '3' });
    expect(three.getAttribute('aria-checked')).toBe('true');
    expect(three.getAttribute('tabindex')).toBe('0');
    expect(
      screen.getByRole('radio', { name: '4' }).getAttribute('tabindex'),
    ).toBe('-1');
    three.focus();
    fireEvent.keyDown(three, { key: 'ArrowRight' });
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(4));
  });

  it('shows the end labels', () => {
    render(
      <RatingBar
        value={null}
        onValueChange={vi.fn()}
        lowLabel="1 = learning"
        highLabel="5 = expert"
        aria-label="Mastery"
      />,
    );
    expect(screen.getByText('1 = learning')).toBeTruthy();
    expect(screen.getByText('5 = expert')).toBeTruthy();
  });

  it('inside an invalid Field it gets aria-invalid and aria-describedby', () => {
    render(
      <Field invalid>
        <RatingBar value={null} onValueChange={vi.fn()} aria-label="Mastery" />
        <FieldDescription>Pick one</FieldDescription>
        <FieldError>Rate this tech</FieldError>
      </Field>,
    );
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const texts = group
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain('Rate this tech');
  });

  it('describes the group with the end labels, alone or next to the Field error', () => {
    const describedBy = () =>
      screen
        .getByRole('radiogroup')
        .getAttribute('aria-describedby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent);
    const bar = (
      <RatingBar
        value={null}
        onValueChange={vi.fn()}
        lowLabel="1 = learning"
        highLabel="5 = expert"
        aria-label="Mastery"
      />
    );

    render(bar);
    expect(describedBy()).toEqual(['1 = learning5 = expert']);
    cleanup();

    render(
      <Field invalid>
        {bar}
        <FieldError>Rate this tech</FieldError>
      </Field>,
    );
    expect(describedBy()).toEqual(
      expect.arrayContaining(['1 = learning5 = expert', 'Rate this tech']),
    );
  });

  it('shows the invalid state on the items from the group', () => {
    render(
      <Field invalid>
        <RatingBar value={null} onValueChange={vi.fn()} aria-label="Mastery" />
      </Field>,
    );
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.classList.contains('group/rating')).toBe(true);
    for (const item of screen.getAllByRole('radio'))
      expect(
        item.classList.contains('group-aria-invalid/rating:border-destructive'),
      ).toBe(true);
  });
});
