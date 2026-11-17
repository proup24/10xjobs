import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobPosting } from '@/lib/matches/postings';
import { JobPostings, MergedBadge } from './job-postings';

const now = new Date('2026-11-17T12:00:00Z');

const posting = (over: Partial<JobPosting>): JobPosting => ({
  rawItemId: 'r',
  channel: 'linkedin-job-board',
  title: 'Engineer',
  location: 'Berlin',
  postedAt: '2026-11-17T09:00:00Z',
  postingUrl: 'https://www.linkedin.com/jobs/view/1',
  shown: false,
  titleDiffers: false,
  placeDiffers: false,
  descriptionDiffers: false,
  ...over,
});

const two = [
  posting({
    rawItemId: 'a',
    title: 'Backend Engineer',
    shown: true,
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
  }),
  posting({
    rawItemId: 'b',
    title: 'Backend Developer',
    titleDiffers: true,
    postingUrl: 'https://www.linkedin.com/jobs/view/2',
  }),
];

afterEach(cleanup);

describe('merged postings', () => {
  it('shows nothing for one posting', () => {
    const { container } = render(
      <>
        <JobPostings postings={[two[0]]} now={now} />
        <MergedBadge postings={[two[0]]} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the badge with the count', () => {
    render(<MergedBadge postings={two} />);
    expect(screen.getByText('Merged · 2 postings')).toBeTruthy();
  });

  it('starts collapsed', () => {
    render(<JobPostings postings={two} now={now} />);
    const toggle = screen.getByRole('button', {
      name: '2 postings share this apply link',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Backend Engineer')).toBeNull();
    expect(screen.queryByText('Backend Developer')).toBeNull();
  });

  it('lists each posting when opened', () => {
    render(<JobPostings postings={two} now={now} />);
    const toggle = screen.getByRole('button', {
      name: '2 postings share this apply link',
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const [first, second] = screen.getAllByRole('listitem');
    expect(first.textContent).toContain('Backend Engineer');
    expect(first.textContent).toContain('shown above');
    expect(first.textContent).not.toContain('title differs');
    expect(second.textContent).toContain('Backend Developer');
    expect(second.textContent).toContain('title differs');
    expect(second.textContent).not.toContain('place differs');
    expect(second.textContent).not.toContain('description differs');
    const links = screen.getAllByRole('link', { name: 'View on LinkedIn' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'https://www.linkedin.com/jobs/view/1',
      'https://www.linkedin.com/jobs/view/2',
    ]);
    for (const l of links) {
      expect(l.getAttribute('target')).toBe('_blank');
      expect(l.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('omits the LinkedIn link for a posting without one', () => {
    render(
      <JobPostings
        postings={[two[0], posting({ rawItemId: 'c', postingUrl: null })]}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getAllByRole('link', { name: 'View on LinkedIn' }),
    ).toHaveLength(1);
  });
});
