import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, FieldError } from './field';
import { FileDropZone } from './file-drop-zone';

afterEach(cleanup);

const accept = { mime: 'application/pdf', extension: '.pdf' };
const MAX = 100;

function setup(props: Partial<React.ComponentProps<typeof FileDropZone>> = {}) {
  const onFileChange = vi.fn();
  const onReject = vi.fn();
  const utils = render(
    <FileDropZone
      accept={accept}
      maxBytes={MAX}
      value={null}
      onFileChange={onFileChange}
      onReject={onReject}
      {...props}
    />,
  );
  const zone = screen.getByRole('button', { name: /choose a file|cv\.pdf/i });
  return { ...utils, zone, onFileChange, onReject };
}

const file = (name: string, type: string, size = 1) =>
  new File([new Uint8Array(size)], name, { type });

describe('FileDropZone', () => {
  it('rejects a wrong type', () => {
    const { zone, onFileChange, onReject } = setup();
    fireEvent.drop(zone, {
      dataTransfer: { files: [file('a.txt', 'text/plain')] },
    });
    expect(onReject).toHaveBeenCalledWith('type');
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('accepts a .pdf with an empty MIME type', () => {
    const { zone, onFileChange, onReject } = setup();
    const f = file('cv.pdf', '');
    fireEvent.drop(zone, { dataTransfer: { files: [f] } });
    expect(onFileChange).toHaveBeenCalledWith(f);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('accepts the PDF MIME type under another name and an upper-case extension', () => {
    const a = setup();
    const f = file('resume', 'application/pdf');
    fireEvent.drop(a.zone, { dataTransfer: { files: [f] } });
    expect(a.onFileChange).toHaveBeenCalledWith(f);
    cleanup();
    const b = setup();
    const g = file('CV.PDF', '');
    fireEvent.drop(b.zone, { dataTransfer: { files: [g] } });
    expect(b.onFileChange).toHaveBeenCalledWith(g);
  });

  it('accepts exactly maxBytes and rejects maxBytes + 1', () => {
    const { zone, onFileChange, onReject } = setup();
    const ok = file('a.pdf', 'application/pdf', MAX);
    fireEvent.drop(zone, { dataTransfer: { files: [ok] } });
    expect(onFileChange).toHaveBeenCalledWith(ok);
    fireEvent.drop(zone, {
      dataTransfer: { files: [file('b.pdf', 'application/pdf', MAX + 1)] },
    });
    expect(onReject).toHaveBeenCalledWith('size');
    expect(onFileChange).toHaveBeenCalledTimes(1);
  });

  it('rejects several files', () => {
    const { zone, onFileChange, onReject } = setup();
    fireEvent.drop(zone, {
      dataTransfer: { files: [file('a.pdf', ''), file('b.pdf', '')] },
    });
    expect(onReject).toHaveBeenCalledWith('multiple');
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('shows the file name and removes it', () => {
    const onFileChange = vi.fn();
    render(
      <FileDropZone
        accept={accept}
        maxBytes={MAX}
        value={file('cv.pdf', 'application/pdf')}
        onFileChange={onFileChange}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(onFileChange).toHaveBeenCalledWith(null);
  });

  it('renders the error with role alert', () => {
    setup({ error: 'Pick a PDF' });
    expect(screen.getByRole('alert').textContent).toBe('Pick a PDF');
  });

  it('opens the hidden input from the focusable button', () => {
    const { zone, container } = setup();
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('application/pdf,.pdf');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(zone);
    expect(click).toHaveBeenCalled();
  });

  it('validates picks like drops and lets the same file be picked again', () => {
    const { container, onFileChange, onReject } = setup();
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const f = file('cv.pdf', '');
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFileChange).toHaveBeenCalledWith(f);
    expect(input.value).toBe('');
    fireEvent.change(input, {
      target: { files: [file('a.txt', 'text/plain')] },
    });
    expect(onReject).toHaveBeenCalledWith('type');
  });

  it('highlights while dragging over and ignores child dragleave', () => {
    const { zone } = setup();
    fireEvent.dragEnter(zone);
    expect(zone.getAttribute('data-drag-over')).toBe('true');
    const child = zone.querySelector('span') as HTMLElement;
    // jsdom has no DragEvent, so relatedTarget must be set on the event.
    const leave = (to: EventTarget) => {
      const ev = createEvent.dragLeave(zone);
      Object.defineProperty(ev, 'relatedTarget', { value: to });
      fireEvent(zone, ev);
    };
    leave(child);
    expect(zone.getAttribute('data-drag-over')).toBe('true');
    leave(document.body);
    expect(zone.getAttribute('data-drag-over')).toBeNull();
    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(zone.getAttribute('data-drag-over')).toBeNull();
  });

  it('ignores drops and picks when disabled', () => {
    const { zone, container, onFileChange, onReject } = setup({
      disabled: true,
    });
    fireEvent.drop(zone, { dataTransfer: { files: [file('cv.pdf', '')] } });
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('cv.pdf', '')] } });
    expect(onFileChange).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect((zone as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes aria wiring from an enclosing Field', () => {
    render(
      <Field invalid>
        <FileDropZone
          accept={accept}
          maxBytes={MAX}
          value={null}
          onFileChange={vi.fn()}
          onReject={vi.fn()}
        />
        <FieldError>Required</FieldError>
      </Field>,
    );
    const zone = screen.getByRole('button', { name: /choose a file/i });
    expect(zone.getAttribute('aria-invalid')).toBe('true');
  });
});
