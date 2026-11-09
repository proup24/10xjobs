import type { AuthorizationKind, JobAnswers, LINK_KINDS } from './answers';

/**
 * Display labels for the fixed setup choices. Plain module (not a client one), so the
 * forms and the server-rendered review share them.
 */

export const LINK_LABELS: Record<(typeof LINK_KINDS)[number], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  portfolio: 'Portfolio',
  website: 'Website',
  other: 'Other',
};

export const LEVEL_LABELS: Record<
  JobAnswers['languages'][number]['level'],
  string
> = {
  native: 'Native',
  fluent: 'Fluent',
  working: 'Working',
};

export const AUTHORIZATION_LABELS: Record<AuthorizationKind, string> = {
  citizenship: 'Citizenship',
  residency: 'Residency',
  'work-permit': 'Work permit',
  clearance: 'Security clearance',
};

/** "512 B", "121 KB", "2.0 MB" (1 KB = 1024 bytes). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
