export interface AuthorView {
  key: string | null;
  name: string | null;
  headline: string | null;
  profileUrl: string | null;
}

export interface DropView {
  rawItemId: string;
  /** The normalized version's reason, as stored. */
  reason: string;
  /** The rule name of a `prepare:` reason; null for any other drop. */
  rule: string | null;
  /** The text a rule matched; null for `prepare: no-text` and other drops. */
  match: string | null;
  postedAt: string | null;
  url: string | null;
  author: AuthorView;
}

export interface HeldPostView {
  jobId: string;
  url: string;
  author: AuthorView;
  postedAt: string | null;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface SilencedAuthorView {
  id: string;
  authorKey: string;
  name: string | null;
  reason: string;
  origin: 'manual' | 'automatic';
  evidence: unknown;
  createdBy: string | null;
  createdAt: string;
}
