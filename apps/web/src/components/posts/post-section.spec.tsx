import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostDetails } from '@/lib/posts/load';
import { NOW, hoursAgo } from '@/components/matches/test-fixtures';
import { PostDetail } from './post-detail';
import { PostSection } from './post-section';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const person = (name: string, id: string) => ({
  key: `profile:${id}`,
  name,
  profileUrl: `https://www.linkedin.com/in/${id}`,
  headline: null,
  type: 'person',
});

const shareSource = {
  id: '7390001',
  url: 'https://www.linkedin.com/feed/update/urn:li:activity:7390001',
  author: person('Sam Sharer', 'sam'),
  text: 'Great team, have a look',
  truncated: false,
  attachedUrls: [],
  postedAt: hoursAgo(30),
  original: {
    id: '7390000',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:7390000',
    author: person('Olga Original', 'olga'),
    text: 'We are hiring a Go engineer. Write to jobs@acme.test',
    truncated: false,
    attachedUrls: [],
    postedAt: hoursAgo(50),
  },
  links: [],
};

const details = (over: Partial<PostDetails> = {}): PostDetails =>
  ({
    jobId: 'R1',
    kind: 'post_role',
    postJobId: 'P1',
    postingUrl: shareSource.url,
    postedAt: hoursAgo(50),
    verdict: {
      value: 'hiring',
      reason: 'hiring',
      confidence: 'sure',
      quote: '',
    },
    howToApply: {
      kinds: ['email', 'external_link', 'connect_dm_comment'],
      email: 'jobs@acme.test',
      emailQuote: 'Write to jobs@acme.test',
      links: ['https://acme.test/careers/go'],
      quote: '',
    },
    authorRelation: 'employer',
    sources: [shareSource],
    emailPending: true,
    rescue: null,
    linked: [
      { jobId: 'L1', kind: 'job', title: 'Go engineer', authorName: null },
      {
        jobId: 'R2',
        kind: 'post_role',
        title: 'Go engineer',
        authorName: 'Paul Poster',
      },
    ],
    ...over,
  }) as PostDetails;

const follows = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('PostSection', () => {
  it("shows a share's sharer text before the original's", () => {
    render(<PostSection details={details()} now={new Date(NOW)} />);
    const sharer = screen.getByText('Great team, have a look');
    const original = screen.getByText(/We are hiring a Go engineer/);
    expect(follows(sharer, original)).toBe(true);
  });

  it('shows when it was posted and how to apply', () => {
    render(<PostSection details={details()} now={new Date(NOW)} />);
    expect(screen.getByText('Posted 2 days ago')).toBeTruthy();
    const email = screen.getByText('jobs@acme.test');
    expect(email).toBeTruthy();
    expect(screen.getByText('Email pending')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'https://acme.test/careers/go' })
        .getAttribute('href'),
    ).toBe('https://acme.test/careers/go');
    expect(
      screen.getByText('DM, comment or connect with the author'),
    ).toBeTruthy();
  });

  it('shows no Email pending once the email is settled', () => {
    render(
      <PostSection
        details={details({ emailPending: false })}
        now={new Date(NOW)}
      />,
    );
    expect(screen.getByText('jobs@acme.test')).toBeTruthy();
    expect(screen.queryByText('Email pending')).toBeNull();
  });

  it('links the author and the sharer to their profiles', () => {
    render(<PostSection details={details()} now={new Date(NOW)} />);
    expect(
      screen.getByRole('link', { name: 'Olga Original' }).getAttribute('href'),
    ).toBe('https://www.linkedin.com/in/olga');
    expect(
      screen.getByRole('link', { name: 'Sam Sharer' }).getAttribute('href'),
    ).toBe('https://www.linkedin.com/in/sam');
  });

  it('links its copies on the job board and in other posts', () => {
    render(<PostSection details={details()} now={new Date(NOW)} />);
    expect(
      screen
        .getByRole('link', { name: /Also on the job board/ })
        .getAttribute('href'),
    ).toBe('/?job=L1');
    expect(
      screen
        .getByRole('link', { name: /Also posted by Paul Poster/ })
        .getAttribute('href'),
    ).toBe('/posts?job=R2');
  });

  it('renders the post text as text, never as HTML', () => {
    const src = { ...shareSource, original: null, text: '<b>bold</b> claim' };
    const { container } = render(
      <PostSection
        details={details({ sources: [src], linked: [] })}
        now={new Date(NOW)}
      />,
    );
    expect(screen.getByText('<b>bold</b> claim')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('PostDetail', () => {
  const junk = details({
    jobId: 'J1',
    kind: 'post',
    postJobId: 'J1',
    verdict: {
      value: 'junk',
      reason: 'course_or_event',
      confidence: 'sure',
      quote: '',
    },
    howToApply: null,
    authorRelation: null,
    emailPending: false,
    linked: [],
  } as unknown as Partial<PostDetails>);

  it('shows a junk post with its verdict and the post, without facts or checks', () => {
    render(
      <PostDetail
        details={junk}
        now={new Date(NOW)}
        userId="u1"
        backHref="/posts?list=junk"
      />,
    );
    const article = within(screen.getByRole('article'));
    expect(article.getByText('Junk · course_or_event')).toBeTruthy();
    expect(article.getByText('Great team, have a look')).toBeTruthy();
    expect(
      article.getByRole('link', { name: 'Open post' }).getAttribute('href'),
    ).toBe(shareSource.url);
    expect(screen.queryByText(/Why it matched/)).toBeNull();
    expect(screen.queryByText('Seniority')).toBeNull();
  });

  it('shows a not-hiring verdict', () => {
    render(
      <PostDetail
        details={details({
          kind: 'post',
          verdict: {
            value: 'not_hiring',
            reason: 'job_seeker',
            confidence: 'sure',
            quote: '',
          },
        })}
        now={new Date(NOW)}
        userId="u1"
        backHref="/posts?list=junk"
      />,
    );
    expect(screen.getByText('Not hiring · job_seeker')).toBeTruthy();
  });
});
