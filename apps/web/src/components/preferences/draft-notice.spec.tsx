import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DraftNotice } from './draft-notice';

describe('DraftNotice', () => {
  it('says the profile is not live and links to finish it', () => {
    render(<DraftNotice profileId="p1" />);
    expect(screen.getByText(/This profile isn't live yet/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Finish setup' }).getAttribute('href'),
    ).toBe('/preferences/new/p1/resume');
  });
});
