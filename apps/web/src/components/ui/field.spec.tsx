import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import { Textarea } from './textarea';

afterEach(cleanup);

function describedText(el: HTMLElement) {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);
}

describe('Field', () => {
  it('links the error to the control', () => {
    render(
      <Field invalid>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" />
        <FieldError>Enter a valid email</FieldError>
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Enter a valid email',
    );
  });

  it('lists the description and the error', () => {
    render(
      <Field invalid>
        <FieldLabel htmlFor="n">Notes</FieldLabel>
        <Textarea id="n" />
        <FieldDescription>Plain text only</FieldDescription>
        <FieldError>Too long</FieldError>
      </Field>,
    );
    const text = describedText(screen.getByLabelText('Notes'));
    expect(text).toContain('Plain text only');
    expect(text).toContain('Too long');
  });

  it('marks nothing invalid when valid, but still links the description', () => {
    render(
      <Field>
        <FieldLabel htmlFor="e">Email</FieldLabel>
        <Input id="e" />
        <FieldDescription>We never share it</FieldDescription>
        <FieldError>Hidden</FieldError>
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(describedText(input)).toEqual(['We never share it']);
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('leaves a control outside a Field alone', () => {
    render(<Input aria-label="Solo" />);
    const input = screen.getByLabelText('Solo');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
