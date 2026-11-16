import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeliveryRow } from '@/lib/webhook/load';
import {
  WebhookDeliveries,
  deliveryStatus,
  formatDeliveryTime,
} from './webhook-deliveries';

afterEach(cleanup);

const row = (over: Partial<DeliveryRow>): DeliveryRow => ({
  id: 'd1',
  kind: 'match',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  profileLabel: 'Backend',
  status: 'delivered',
  attempts: 1,
  lastStatusCode: 200,
  lastError: null,
  createdAt: '2026-11-16T10:02:00Z',
  ...over,
});

describe('deliveryStatus', () => {
  it.each([
    [row({}), 'Delivered · 200'],
    [row({ status: 'pending', attempts: 0, lastStatusCode: null }), 'Pending'],
    [
      row({ status: 'pending', attempts: 2, lastStatusCode: 503 }),
      'attempt 2 of 7 · 503',
    ],
    [
      row({
        status: 'pending',
        attempts: 1,
        lastStatusCode: null,
        lastError: 'timeout',
      }),
      'attempt 1 of 7 · timeout',
    ],
    [row({ status: 'sending', lastStatusCode: null }), 'Sending'],
    [
      row({
        status: 'failed',
        lastStatusCode: null,
        lastError: 'blocked address',
      }),
      'Failed · blocked address',
    ],
    [row({ status: 'failed', lastStatusCode: 410 }), 'Failed · 410'],
    [row({ status: 'skipped', lastStatusCode: null }), 'Skipped'],
  ])('%#', (r, text) => {
    expect(deliveryStatus(r).text).toBe(text);
  });
});

describe('WebhookDeliveries', () => {
  it('lists match and test rows', () => {
    render(
      <WebhookDeliveries
        deliveries={[
          row({}),
          row({
            id: 't',
            kind: 'test',
            title: null,
            companyName: null,
            profileLabel: null,
            status: 'failed',
            lastStatusCode: null,
            lastError: 'blocked address',
          }),
          row({ id: 'gone', title: null, companyName: null }),
        ]}
      />,
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Senior Backend Engineer · Acme');
    expect(items[0].textContent).toContain('Backend');
    expect(items[0].textContent).toContain('Delivered · 200');
    expect(items[0].querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-11-16T10:02:00Z',
    );
    expect(items[1].textContent).toContain('Test');
    expect(items[1].textContent).toContain('Failed · blocked address');
    expect(items[2].textContent).toContain('A job no longer in your matches');
  });

  it('server-renders the time in UTC, the same on every server and in hydration', () => {
    const html = renderToString(<WebhookDeliveries deliveries={[row({})]} />);
    expect(html).toContain('16 Nov, 10:02 UTC');
  });

  it('shows the time in the browser in its own time zone', () => {
    render(<WebhookDeliveries deliveries={[row({})]} />);
    expect(
      screen.getByText(formatDeliveryTime('2026-11-16T10:02:00Z')),
    ).toBeTruthy();
  });

  it('says when there are none', () => {
    render(<WebhookDeliveries deliveries={[]} />);
    expect(screen.getByText('No deliveries yet.')).toBeTruthy();
  });
});

describe('formatDeliveryTime', () => {
  it('formats day, month and 24-hour time in en-GB, in the given zone', () => {
    expect(formatDeliveryTime('2026-11-16T10:02:00Z', 'UTC')).toBe(
      '16 Nov, 10:02',
    );
    expect(formatDeliveryTime('2026-11-16T22:02:00Z', 'Asia/Tokyo')).toBe(
      '17 Nov, 07:02',
    );
  });
});
