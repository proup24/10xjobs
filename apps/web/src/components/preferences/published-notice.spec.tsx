import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PublishedNotice } from './published-notice';

describe('PublishedNotice', () => {
  it('shows the applying line only while searches are behind', () => {
    const { rerender } = render(<PublishedNotice applying={false} />);
    expect(
      screen.getByText(
        'Changes apply to the next searches and to jobs from the last 30 days.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/being applied/)).toBeNull();

    rerender(<PublishedNotice applying />);
    expect(
      screen.getByText(
        'Changes apply to the next searches and to jobs from the last 30 days.',
      ),
    ).toBeTruthy();
    const line = screen.getByText(
      'Your last change is being applied to the searches.',
    );
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
  });
});
