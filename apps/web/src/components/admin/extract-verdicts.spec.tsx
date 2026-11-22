import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AutoSilenceCandidateView,
  VerdictView,
} from '@xjobs/engine-client';
import { ExtractVerdicts } from './extract-verdicts';

vi.mock('@/app/(app)/admin/prepare/actions', () => ({
  silenceAuthorAction: vi.fn(),
  unsilenceAuthorAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const verdict = (over: Partial<VerdictView> = {}): VerdictView => ({
  jobId: 'j1',
  verdict: 'junk',
  reason: 'funnel',
  quote: 'Join my group for daily jobs',
  confidence: 'sure',
  author: {
    key: 'profile:jane',
    name: 'Jane Doe',
    headline: 'Career coach',
    profileUrl: null,
  },
  postedAt: '2026-11-21T08:00:00.000Z',
  url: 'https://www.linkedin.com/posts/1',
  extractedAt: '2026-11-22T09:00:00.000Z',
  ...over,
});

type Props = Parameters<typeof ExtractVerdicts>[0];
const setup = (over: Partial<Props> = {}) =>
  render(
    <ExtractVerdicts
      verdict={null}
      reason={null}
      page={{ items: [verdict()], next: null }}
      silenced={new Set()}
      nextHref={null}
      candidates={[]}
      {...over}
    />,
  );

const region = () =>
  within(screen.getByRole('region', { name: 'Extract verdicts' }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ExtractVerdicts', () => {
  it('renders the verdict and reason filters as a GET form', () => {
    setup();
    const verdictSelect = region().getByRole('combobox', { name: 'Verdict' });
    const reasonSelect = region().getByRole('combobox', { name: 'Reason' });
    expect(verdictSelect).toBeTruthy();
    expect(reasonSelect).toBeTruthy();
    const form = verdictSelect.closest('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/admin/prepare');
    expect(region().getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(region().queryByRole('link', { name: 'Clear filter' })).toBeNull();
  });

  it('shows the filter in force and a way to clear it', () => {
    setup({ verdict: 'junk', reason: 'funnel' });
    expect(
      region().getByRole('combobox', { name: 'Verdict' }).textContent,
    ).toContain('Junk');
    expect(
      region().getByRole('combobox', { name: 'Reason' }).textContent,
    ).toContain('funnel');
    const form = region()
      .getByRole('combobox', { name: 'Verdict' })
      .closest('form')!;
    const data = new FormData(form);
    expect(data.get('verdict')).toBe('junk');
    expect(data.get('reason')).toBe('funnel');
    expect(
      region().getByRole('link', { name: 'Clear filter' }).getAttribute('href'),
    ).toBe('/admin/prepare');
  });

  it('lists a row with its verdict, reason, quote, author, headline and post link', () => {
    setup();
    const row = within(region().getAllByRole('row')[1]!);
    expect(row.getByText('Junk')).toBeTruthy();
    expect(row.getByText('funnel')).toBeTruthy();
    expect(row.getByText('Join my group for daily jobs')).toBeTruthy();
    expect(row.getByText('Jane Doe')).toBeTruthy();
    expect(row.getByText('Career coach')).toBeTruthy();
    expect(row.getByText('2026-11-21')).toBeTruthy();
    const link = row.getByRole('link', { name: 'Open post' });
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/posts/1');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('marks an unsure verdict', () => {
    setup({ page: { items: [verdict({ confidence: 'unsure' })], next: null } });
    expect(region().getByText('Unsure')).toBeTruthy();
  });

  it("offers the existing silence action for a row's author", async () => {
    setup();
    fireEvent.click(region().getByRole('button', { name: 'Silence' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/for everyone/i)).toBeTruthy();
  });

  it('shows Silenced instead of the action for a silenced author, and none without a key', () => {
    setup({
      silenced: new Set(['profile:jane']),
      page: {
        items: [
          verdict(),
          verdict({
            jobId: 'j2',
            author: {
              key: null,
              name: null,
              headline: null,
              profileUrl: null,
            },
          }),
        ],
        next: null,
      },
    });
    expect(region().getByText('Silenced')).toBeTruthy();
    expect(region().queryByRole('button', { name: 'Silence' })).toBeNull();
    expect(region().getByText('Unknown author')).toBeTruthy();
  });

  it('says when nothing is listed, when the list failed, and links the next page', () => {
    setup({ page: { items: [], next: null } });
    expect(
      region().getByText('No posts ruled not hiring or junk.'),
    ).toBeTruthy();
    cleanup();
    setup({ page: null, nextHref: null });
    expect(region().getByText("Couldn't load extract verdicts.")).toBeTruthy();
    cleanup();
    setup({ nextHref: '/admin/prepare?verdicts=c2' });
    expect(
      region()
        .getByRole('link', { name: 'Next verdicts' })
        .getAttribute('href'),
    ).toBe('/admin/prepare?verdicts=c2');
  });

  describe('automatic silencing candidates', () => {
    const candidate: AutoSilenceCandidateView = {
      authorKey: 'company:agg',
      name: 'Agg Jobs',
      counted: 12,
      firstSeenAt: '2026-11-01T08:00:00.000Z',
      lastSeenAt: '2026-11-09T08:00:00.000Z',
      verdicts: { junk: 10, not_hiring: 2 },
    };
    const candidates = () =>
      within(
        screen.getByRole('region', { name: 'Automatic silencing candidates' }),
      );

    it('lists each candidate with its evidence and the silence action', async () => {
      setup({ candidates: [candidate] });
      const row = within(candidates().getAllByRole('row')[1]!);
      expect(row.getByText('Agg Jobs')).toBeTruthy();
      expect(row.getByText('company:agg')).toBeTruthy();
      expect(row.getByText('12')).toBeTruthy();
      expect(row.getByText('2026-11-01')).toBeTruthy();
      expect(row.getByText('2026-11-09')).toBeTruthy();
      expect(row.getByText('Junk 10')).toBeTruthy();
      expect(row.getByText('Not hiring 2')).toBeTruthy();
      fireEvent.click(row.getByRole('button', { name: 'Silence' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/for everyone/i)).toBeTruthy();
    });

    it('says when nobody meets the rule, and when the list failed', () => {
      setup({ candidates: [] });
      expect(
        candidates().getByText('No author meets the automatic silencing rule.'),
      ).toBeTruthy();
      cleanup();
      setup({ candidates: null });
      expect(
        candidates().getByText("Couldn't load automatic silencing candidates."),
      ).toBeTruthy();
    });
  });
});
