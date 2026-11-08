import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import { Textarea } from './textarea';
import { InputGroup, InputGroupInput } from './input-group';

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

  it('sets aria-required from a required Field and marks the label', () => {
    render(
      <Field required>
        <FieldLabel htmlFor="r">Name</FieldLabel>
        <Input id="r" />
      </Field>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input.getAttribute('aria-required')).toBe('true');
    const mark = document.querySelector('[data-slot="field-required"]')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(
      document
        .querySelector('[data-slot="field"]')!
        .getAttribute('data-required'),
    ).toBe('true');
  });

  it('lets an explicit aria-required win', () => {
    render(
      <Field required>
        <FieldLabel htmlFor="o">Opt</FieldLabel>
        <Input id="o" aria-required="false" />
      </Field>,
    );
    expect(screen.getByLabelText(/Opt/).getAttribute('aria-required')).toBe(
      'false',
    );
  });

  it('shows no marker when not required', () => {
    render(
      <Field>
        <FieldLabel htmlFor="n2">Plain</FieldLabel>
        <Input id="n2" />
      </Field>,
    );
    expect(document.querySelector('[data-slot="field-required"]')).toBeNull();
    expect(
      screen.getByLabelText('Plain').getAttribute('aria-required'),
    ).toBeNull();
  });
});

describe('text inputs', () => {
  // Below 16px, iOS Safari zooms the page when a field takes focus.
  it('are 16px on small screens and 14px from md up', () => {
    render(
      <>
        <Input aria-label="plain" />
        <Textarea aria-label="area" />
        <InputGroup>
          <InputGroupInput aria-label="grouped" />
        </InputGroup>
      </>,
    );
    for (const name of ['plain', 'area', 'grouped']) {
      const classes = screen.getByLabelText(name).className.split(' ');
      expect(classes, name).toContain('text-base');
      expect(classes, name).toContain('md:text-sm');
      expect(classes, name).not.toContain('text-sm');
    }
  });
});
