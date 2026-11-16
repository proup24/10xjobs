import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '@/components/layout/unsaved-changes';
import type { WebhookView } from '@/lib/webhook/load';
import { WebhookForm } from './webhook-form';

const actions = vi.hoisted(() => ({
  saveWebhookUrl: vi.fn(),
  setWebhookEnabled: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  deleteWebhook: vi.fn(),
  sendWebhookTest: vi.fn(),
}));
vi.mock('@/lib/webhook/actions', () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const ON: WebhookView = {
  url: 'https://hooks.example.com/a',
  secret: SECRET,
  enabled: true,
  disabledReason: null,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
};

beforeEach(() => {
  for (const fn of Object.values(actions))
    fn.mockResolvedValue({ status: 'saved' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(webhook: WebhookView | null) {
  return render(
    <UnsavedChangesProvider>
      <WebhookForm webhook={webhook} />
    </UnsavedChangesProvider>,
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const urlInput = () => screen.getByLabelText('URL') as HTMLInputElement;

describe('WebhookForm', () => {
  it('none: only the URL and Save', () => {
    renderForm(null);
    expect(urlInput().value).toBe('');
    expect(button('Save')).toBeTruthy();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull();
  });

  it('on: status On, Turn off, the secret masked', () => {
    renderForm(ON);
    expect(urlInput().value).toBe(ON.url);
    expect(screen.getByText('On')).toBeTruthy();
    expect(button('Turn off')).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(button('Show'));
    expect(screen.getByText(SECRET)).toBeTruthy();
    fireEvent.click(button('Hide'));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(button('Send test')).toBeTruthy();
  });

  it('off by user: status Off and Turn on', () => {
    renderForm({ ...ON, enabled: false, disabledReason: 'user' });
    expect(screen.getByText('Off')).toBeTruthy();
    expect(button('Turn on')).toBeTruthy();
    expect(
      screen.queryByText('Off: turned off after 10 failed sends.'),
    ).toBeNull();
  });

  it('off from failing: says why, and Turn on', () => {
    renderForm({
      ...ON,
      enabled: false,
      disabledReason: 'failing',
      consecutiveFailures: 10,
    });
    expect(
      screen.getByText('Off: turned off after 10 failed sends.'),
    ).toBeTruthy();
    expect(button('Turn on')).toBeTruthy();
  });

  it('shows the client URL problem and calls nothing', async () => {
    renderForm(null);
    fireEvent.change(urlInput(), { target: { value: 'http://x.example.com' } });
    fireEvent.click(button('Save'));
    expect(await screen.findByText('Use an https:// URL.')).toBeTruthy();
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    expect(actions.saveWebhookUrl).not.toHaveBeenCalled();
  });

  it('saves the URL, toasts and refreshes', async () => {
    renderForm(null);
    fireEvent.change(urlInput(), {
      target: { value: 'https://hooks.example.com/b' },
    });
    fireEvent.click(button('Save'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.saveWebhookUrl).toHaveBeenCalledWith(
      'https://hooks.example.com/b',
    );
    expect(toast.success).toHaveBeenCalledWith('Saved');
  });

  it("shows the server's URL error on the field", async () => {
    actions.saveWebhookUrl.mockResolvedValue({
      status: 'invalid',
      errors: { url: "This URL can't be used for a webhook." },
    });
    renderForm(null);
    fireEvent.change(urlInput(), {
      target: { value: 'https://hooks.example.com/b' },
    });
    fireEvent.click(button('Save'));
    expect(
      await screen.findByText("This URL can't be used for a webhook."),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('turns off and on', async () => {
    renderForm(ON);
    fireEvent.click(button('Turn off'));
    await waitFor(() =>
      expect(actions.setWebhookEnabled).toHaveBeenCalledWith(false),
    );
    cleanup();
    renderForm({ ...ON, enabled: false, disabledReason: 'user' });
    fireEvent.click(button('Turn on'));
    await waitFor(() =>
      expect(actions.setWebhookEnabled).toHaveBeenCalledWith(true),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('rotate confirms first', async () => {
    renderForm(ON);
    fireEvent.click(button('Rotate'));
    expect(actions.rotateWebhookSecret).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Rotate secret',
      ) as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(actions.rotateWebhookSecret).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('copies the secret', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderForm(ON);
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(toast.success).toHaveBeenCalledWith('Copied');
  });

  it('send test: queued, or the refusal as a toast', async () => {
    renderForm(ON);
    fireEvent.click(button('Send test'));
    await waitFor(() => expect(actions.sendWebhookTest).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    actions.sendWebhookTest.mockResolvedValue({
      status: 'invalid',
      errors: { _form: 'Wait a few seconds before sending another test.' },
    });
    fireEvent.click(button('Send test'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Wait a few seconds before sending another test.',
      ),
    );
  });

  it('a failed action toasts the save failure', async () => {
    actions.setWebhookEnabled.mockResolvedValue({ status: 'failed' });
    renderForm(ON);
    fireEvent.click(button('Turn off'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
  });

  it('remove confirms, then deletes', async () => {
    renderForm(ON);
    fireEvent.click(button('Remove webhook'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Remove webhook',
      ) as HTMLButtonElement,
    );
    await waitFor(() => expect(actions.deleteWebhook).toHaveBeenCalled());
  });
});
