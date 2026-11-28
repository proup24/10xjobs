import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobPosting } from '@/lib/matches/postings';
import { JobPostings, MergedBadge } from './job-postings';

const now = new Date('2026-11-17T12:00:00Z');

const posting = (over: Partial<JobPosting>): JobPosting => ({
  rawItemId: 'r',
  channel: 'LINKEDIN_JOB_BOARD',
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

describe('posting link wording', () => {
  it('names the posting source', () => {
    render(
      <JobPostings
        postings={[
          two[0],
          posting({
            rawItemId: 'i',
            channel: 'INDEED',
            postingUrl: 'https://www.indeed.com/viewjob?jk=1',
          }),
          posting({
            rawItemId: 'x',
            channel: 'SOMETHING_ELSE',
            postingUrl: 'https://example.com/jobs/1',
          }),
        ]}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('View on Indeed')).toBeTruthy();
    expect(screen.getByText('View on LinkedIn')).toBeTruthy();
    expect(screen.getByText('View posting')).toBeTruthy();
  });
});

describe('actor badge', () => {
  it('names the actor on a cheap posting', () => {
    render(
      <JobPostings
        postings={[
          two[0],
          posting({
            rawItemId: 'c',
            channel: 'LINKEDIN_JOB_BOARD_CHEAP',
            postingUrl: 'https://www.linkedin.com/jobs/view/3',
          }),
        ]}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('LinkedIn · cheap_scraper')).toBeTruthy();
  });
});

describe('one LinkedIn job seen by both actors', () => {
  const harvest = posting({
    rawItemId: 'h',
    channel: 'LINKEDIN_JOB_BOARD',
    title: 'Backend Engineer',
    location: 'Berlin, Germany',
    shown: true,
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
  });
  // The trial's copy of the same LinkedIn job: its text and place differ.
  const cheap = posting({
    rawItemId: 'c',
    channel: 'LINKEDIN_JOB_BOARD_CHEAP',
    title: 'Backend Engineer (trial copy)',
    location: 'Berlin',
    placeDiffers: true,
    descriptionDiffers: true,
    titleDiffers: true,
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
  });
  const other = posting({
    rawItemId: 'o',
    channel: 'LINKEDIN_JOB_BOARD',
    title: 'Backend Developer',
    titleDiffers: true,
    postingUrl: 'https://www.linkedin.com/jobs/view/2',
  });

  it('is one posting, not a merge', () => {
    const { container } = render(
      <>
        <MergedBadge postings={[cheap, harvest]} />
        <JobPostings postings={[cheap, harvest]} now={now} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('counts it once among other postings', () => {
    render(<MergedBadge postings={[harvest, cheap, other]} />);
    expect(screen.getByText('Merged · 2 postings')).toBeTruthy();
  });

  it("shows one row with harvestapi's fields and a badge per actor, harvestapi first", () => {
    render(<JobPostings postings={[cheap, harvest, other]} now={now} />);
    fireEvent.click(
      screen.getByRole('button', { name: '2 postings share this apply link' }),
    );
    const [first, second] = screen.getAllByRole('listitem');
    expect(first.textContent).toContain('Backend Engineer');
    expect(first.textContent).not.toContain('trial copy');
    expect(first.textContent).toContain('Berlin, Germany');
    expect(first.textContent).toContain('shown above');
    expect(first.textContent).not.toContain('differs');
    const text = first.textContent ?? '';
    expect(text.indexOf('LinkedIn · harvestapi')).toBeGreaterThan(-1);
    expect(text.indexOf('LinkedIn · cheap_scraper')).toBeGreaterThan(
      text.indexOf('LinkedIn · harvestapi'),
    );
    expect(second.textContent).toContain('Backend Developer');
  });
});

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
