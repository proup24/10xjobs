import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Resume } from '@/components/setup/resume-field';
import { ResumeSection } from './sections';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

// A stand-in field: reports the resume on mount, and a new one on "upload".
vi.mock('@/components/setup/resume-field', async () => {
  const { useEffect, useState } = await import('react');
  return {
    ResumeField: ({
      current,
      onChange,
    }: {
      current: Resume | null;
      onChange?: (s: { resume: Resume | null; uploading: boolean }) => void;
    }) => {
      const [resume, setResume] = useState(current);
      const [uploading, setUploading] = useState(false);
      useEffect(() => {
        onChange?.({ resume, uploading });
      }, [resume, uploading]);
      return (
        <>
          <button type="button" onClick={() => setUploading(true)}>
            start
          </button>
          <button
            type="button"
            onClick={() => {
              setUploading(false);
              setResume({ filename: 'new.pdf', sizeBytes: 10 });
            }}
          >
            finish
          </button>
          <button type="button" onClick={() => setUploading(false)}>
            fail
          </button>
        </>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

describe('ResumeSection', () => {
  it('has a Resume heading and no Save button', () => {
    render(<ResumeSection profileId="p" userId="u" current={null} />);
    expect(screen.getByRole('heading', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('refreshes after an upload, not on mount or a failed upload', () => {
    render(
      <ResumeSection
        profileId="p"
        userId="u"
        current={{ filename: 'old.pdf', sizeBytes: 5 }}
      />,
    );
    expect(refresh).not.toHaveBeenCalled();
    click('start');
    click('fail');
    expect(refresh).not.toHaveBeenCalled();
    click('start');
    click('finish');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
