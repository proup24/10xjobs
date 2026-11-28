// Framework-free on purpose: no Next and no `server-only` import, so this file
// can be unit tested here and exercised by the engine e2e suite. The engine key
// is read only in the web app's `apps/web/src/lib/engine/server.ts`, which does
// import `server-only`, and is handed in through `deps`.
export type PublishedProfile = { id: string; state: string };

export type SearchSwitchKey = 'posts' | 'indeed';
export type SearchSwitchView = {
  key: SearchSwitchKey;
  enabled: boolean;
  searches: number;
  /** When paused for the day's posts budget, the instant post searches resume. */
  pausedUntil: string | null;
};

/** The signed-in user's searches: paused, and when they were last active. */
export type SearchesStateView = {
  paused: boolean;
  lastActiveAt: string | null;
};

/** Matches the engine's `/api/admin/*` DTOs (`apps/xjobs/src/modules/admin`). */
export type AuthorView = {
  key: string | null;
  name: string | null;
  headline: string | null;
  profileUrl: string | null;
};
export type DropView = {
  rawItemId: string;
  reason: string;
  /** The rule name of a `prepare:` reason; null for any other drop. */
  rule: string | null;
  /** The text the rule matched; null for `prepare: no-text` and other drops. */
  match: string | null;
  postedAt: string | null;
  url: string | null;
  author: AuthorView;
};
export type HeldPostView = {
  jobId: string;
  url: string;
  author: AuthorView;
  postedAt: string | null;
};
export type VerdictView = {
  jobId: string;
  /** A `LISTED_VERDICTS` code (`@xjobs/database/enums`). */
  verdict: string;
  /** A `POST_VERDICT_REASONS` code (`@xjobs/database/enums`). */
  reason: string;
  /** The verbatim quote the verdict rests on. */
  quote: string;
  confidence: 'sure' | 'unsure';
  /** The original post's author (a share's original, never the sharer). */
  author: AuthorView;
  postedAt: string | null;
  url: string;
  extractedAt: string;
};
/** One Morocco day of post search spend. */
export type PostsBudgetDayView = {
  dayStart: string;
  spentUsd: number;
  reachedAt: string | null;
};
/** The owner's post search budget report (`GET /api/admin/posts-budget`). */
export type PostsBudgetView = {
  limitUsd: number;
  today: PostsBudgetDayView;
  /** The 7 Morocco days before today, newest first. */
  days: PostsBudgetDayView[];
  /** Most behind first. */
  searches: {
    key: string;
    profiles: number;
    oldestCoveredUntil: string | null;
    overDay: boolean;
  }[];
  pausedBuilders: number;
  fullRuns: { key: string; runs: number; lastAt: string }[];
};
/** One post rescue, for the owner's report (`GET /api/admin/rescues`). */
export type RescueView = {
  id: string;
  createdAt: string;
  undoneAt: string | null;
  origin: 'junk' | 'disqualified';
  note: string | null;
  /** What the system said when the user rescued the post; shape depends on `origin`. */
  snapshot: unknown;
  job: {
    id: string;
    kind: string;
    title: string | null;
    postingUrl: string;
  };
  user: { id: string };
};
/** An author the automatic silencing rule would silence, with its evidence. */
export type AutoSilenceCandidateView = {
  authorKey: string;
  name: string | null;
  /** Posts counted (role_filled ones are not). */
  counted: number;
  /** The first and last counted post's firstSeenAt. */
  firstSeenAt: string;
  lastSeenAt: string;
  /** Counted posts per verdict. */
  verdicts: Record<string, number>;
};
/** `next` is an opaque cursor: pass it back as `before`. */
export type ReviewPage<T> = { items: T[]; next: string | null };
export type SilencedAuthorView = {
  id: string;
  authorKey: string;
  name: string | null;
  reason: string;
  origin: 'manual' | 'automatic';
  evidence: unknown;
  createdBy: string | null;
  createdAt: string;
};
export type SilenceInput = {
  authorKey: string;
  name?: string | null;
  reason: string;
};

export type EngineResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not-found' }
  | {
      kind: 'conflict';
      reason: 'already-published' | 'incomplete' | 'not-published';
    }
  | { kind: 'invalid'; message: string }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' };

export interface EngineClientDeps {
  url: string | undefined;
  apiKey: string | undefined;
  accessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface EngineClient {
  publishProfile(profileId: string): Promise<EngineResult<PublishedProfile>>;
  deleteProfile(profileId: string): Promise<EngineResult<{ id: string }>>;
  searchSwitches(profileId: string): Promise<EngineResult<SearchSwitchView[]>>;
  setSearchSwitch(
    profileId: string,
    key: SearchSwitchKey,
    enabled: boolean,
  ): Promise<EngineResult<SearchSwitchView>>;
  searchesState(): Promise<EngineResult<SearchesStateView>>;
  /** Resumes the user's paused searches; already running is a success. */
  resumeSearches(): Promise<EngineResult<SearchesStateView>>;
  /** Whether the signed-in user is an admin; any signed-in user may ask. */
  adminMe(): Promise<EngineResult<{ admin: boolean }>>;
  prepareDrops(options?: {
    rule?: string;
    before?: string;
    limit?: number;
  }): Promise<EngineResult<ReviewPage<DropView>>>;
  silencedPosts(options?: {
    before?: string;
    limit?: number;
  }): Promise<EngineResult<ReviewPage<HeldPostView>>>;
  extractVerdicts(options?: {
    verdict?: string;
    reason?: string;
    before?: string;
    limit?: number;
  }): Promise<EngineResult<ReviewPage<VerdictView>>>;
  /** Every user's post rescues, newest first, undone ones included. */
  adminRescues(options?: {
    limit?: number;
  }): Promise<EngineResult<{ items: RescueView[] }>>;
  /** Post search spend against the daily limit, and how far behind the searches are. */
  adminPostsBudget(): Promise<EngineResult<PostsBudgetView>>;
  /** Who automatic silencing would silence now; already silenced authors are left out. */
  autoSilenceCandidates(): Promise<EngineResult<AutoSilenceCandidateView[]>>;
  silencedAuthors(): Promise<EngineResult<SilencedAuthorView[]>>;
  /** 201 gives `silenced`, 200 `already`. */
  silenceAuthor(
    input: SilenceInput,
  ): Promise<EngineResult<{ status: 'silenced' | 'already' }>>;
  /** 204 gives `ok` with null; 404 when the author was not silenced. */
  unsilenceAuthor(authorKey: string): Promise<EngineResult<null>>;
  /**
   * Forwards a receiver's webhook callback to the engine unchanged: the raw
   * bytes, the three `X-10xjobs-*` headers and the content type, plus the
   * engine key. Never sends an access token. Returns the engine's status and
   * body text as is; a missing url or key, or a failed fetch, is `unavailable`.
   */
  forwardWebhookCallback(input: {
    body: Uint8Array;
    headers: Record<CallbackHeader, string | null>;
    contentType?: string | null;
  }): Promise<{ status: number; body: string } | { kind: 'unavailable' }>;
}

export type CallbackHeader =
  | 'x-10xjobs-webhook'
  | 'x-10xjobs-timestamp'
  | 'x-10xjobs-signature';

const DEFAULT_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isNullableString = (v: unknown): v is string | null =>
  v === null || typeof v === 'string';

function isAuthorView(v: unknown): v is AuthorView {
  return (
    isRecord(v) &&
    isNullableString(v.key) &&
    isNullableString(v.name) &&
    isNullableString(v.headline) &&
    isNullableString(v.profileUrl)
  );
}

function isDropView(v: unknown): v is DropView {
  return (
    isRecord(v) &&
    typeof v.rawItemId === 'string' &&
    typeof v.reason === 'string' &&
    isNullableString(v.rule) &&
    isNullableString(v.match) &&
    isNullableString(v.postedAt) &&
    isNullableString(v.url) &&
    isAuthorView(v.author)
  );
}

function isHeldPostView(v: unknown): v is HeldPostView {
  return (
    isRecord(v) &&
    typeof v.jobId === 'string' &&
    typeof v.url === 'string' &&
    isNullableString(v.postedAt) &&
    isAuthorView(v.author)
  );
}

function isVerdictView(v: unknown): v is VerdictView {
  return (
    isRecord(v) &&
    typeof v.jobId === 'string' &&
    typeof v.verdict === 'string' &&
    typeof v.reason === 'string' &&
    typeof v.quote === 'string' &&
    (v.confidence === 'sure' || v.confidence === 'unsure') &&
    isAuthorView(v.author) &&
    isNullableString(v.postedAt) &&
    typeof v.url === 'string' &&
    typeof v.extractedAt === 'string'
  );
}

function isRescueView(v: unknown): v is RescueView {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'string' &&
    isNullableString(v.undoneAt) &&
    (v.origin === 'junk' || v.origin === 'disqualified') &&
    isNullableString(v.note) &&
    isRecord(v.job) &&
    typeof v.job.id === 'string' &&
    typeof v.job.kind === 'string' &&
    isNullableString(v.job.title) &&
    typeof v.job.postingUrl === 'string' &&
    isRecord(v.user) &&
    typeof v.user.id === 'string'
  );
}

function isPostsBudgetDayView(v: unknown): v is PostsBudgetDayView {
  return (
    isRecord(v) &&
    typeof v.dayStart === 'string' &&
    typeof v.spentUsd === 'number' &&
    isNullableString(v.reachedAt)
  );
}

function isPostsBudgetView(v: unknown): v is PostsBudgetView {
  return (
    isRecord(v) &&
    typeof v.limitUsd === 'number' &&
    isPostsBudgetDayView(v.today) &&
    Array.isArray(v.days) &&
    v.days.every(isPostsBudgetDayView) &&
    Array.isArray(v.searches) &&
    v.searches.every(
      (x) =>
        isRecord(x) &&
        typeof x.key === 'string' &&
        typeof x.profiles === 'number' &&
        isNullableString(x.oldestCoveredUntil) &&
        typeof x.overDay === 'boolean',
    ) &&
    typeof v.pausedBuilders === 'number' &&
    Array.isArray(v.fullRuns) &&
    v.fullRuns.every(
      (x) =>
        isRecord(x) &&
        typeof x.key === 'string' &&
        typeof x.runs === 'number' &&
        typeof x.lastAt === 'string',
    )
  );
}

function isAutoSilenceCandidateView(v: unknown): v is AutoSilenceCandidateView {
  return (
    isRecord(v) &&
    typeof v.authorKey === 'string' &&
    isNullableString(v.name) &&
    typeof v.counted === 'number' &&
    typeof v.firstSeenAt === 'string' &&
    typeof v.lastSeenAt === 'string' &&
    isRecord(v.verdicts) &&
    Object.values(v.verdicts).every((n) => typeof n === 'number')
  );
}

function isSilencedAuthorView(v: unknown): v is SilencedAuthorView {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.authorKey === 'string' &&
    isNullableString(v.name) &&
    typeof v.reason === 'string' &&
    (v.origin === 'manual' || v.origin === 'automatic') &&
    isNullableString(v.createdBy) &&
    typeof v.createdAt === 'string'
  );
}

function pageOf<T>(
  isItem: (v: unknown) => v is T,
): (data: unknown) => ReviewPage<T> | undefined {
  return (data) =>
    isRecord(data) &&
    Array.isArray(data.items) &&
    data.items.every(isItem) &&
    isNullableString(data.next)
      ? { items: data.items, next: data.next }
      : undefined;
}

function queryOf(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
}

function parseSearchesState(data: unknown): SearchesStateView | undefined {
  return isRecord(data) &&
    typeof data.paused === 'boolean' &&
    (data.lastActiveAt === null || typeof data.lastActiveAt === 'string')
    ? { paused: data.paused, lastActiveAt: data.lastActiveAt }
    : undefined;
}

export function createEngineClient(deps: EngineClientDeps): EngineClient {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((line: string) => console.warn(line));

  async function publishProfile(
    profileId: string,
  ): Promise<EngineResult<PublishedProfile>> {
    let status: number | undefined;
    // Not a UUID: the engine would 400 it, and the raw input stays out of the log.
    const validId = UUID.test(profileId);
    const finish = (
      result: EngineResult<PublishedProfile>,
    ): EngineResult<PublishedProfile> => {
      log(
        `engine publishProfile profile=${validId ? profileId : 'invalid'} outcome=${result.kind} status=${status ?? 'none'}`,
      );
      return result;
    };

    if (!validId) return finish({ kind: 'not-found' });

    if (!deps.url || !deps.apiKey) return finish({ kind: 'unavailable' });

    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      return finish({ kind: 'unavailable' });
    }
    if (!token) return finish({ kind: 'unauthorized' });

    try {
      const response = await doFetch(
        `${deps.url.replace(/\/+$/, '')}/api/profiles/${encodeURIComponent(profileId)}/publish`,
        {
          method: 'POST',
          headers: {
            'X-Engine-Key': deps.apiKey,
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
      );
      status = response.status;

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return finish({ kind: 'unavailable' });
      }
      const record = isRecord(body) ? body : {};

      if (status === 200) {
        const data = record.data;
        if (
          isRecord(data) &&
          typeof data.id === 'string' &&
          typeof data.state === 'string'
        ) {
          return finish({ kind: 'ok', data: data as PublishedProfile });
        }
        return finish({ kind: 'unavailable' });
      }
      if (status === 401) return finish({ kind: 'unauthorized' });
      if (status === 404) return finish({ kind: 'not-found' });
      if (status === 409) {
        if (record.code === 'PROFILE_PUBLISHED')
          return finish({ kind: 'conflict', reason: 'already-published' });
        if (record.code === 'ELIGIBILITY_REQUIRED')
          return finish({ kind: 'conflict', reason: 'incomplete' });
        return finish({ kind: 'unavailable' });
      }
      if (status === 400) {
        const message =
          typeof record.message === 'string' ? record.message : 'Bad request';
        return finish({ kind: 'invalid', message });
      }
      return finish({ kind: 'unavailable' });
    } catch {
      return finish({ kind: 'unavailable' });
    }
  }

  async function deleteProfile(
    profileId: string,
  ): Promise<EngineResult<{ id: string }>> {
    let status: number | undefined;
    // Not a UUID: the engine would 400 it, and the raw input stays out of the log.
    const validId = UUID.test(profileId);
    const finish = (
      result: EngineResult<{ id: string }>,
    ): EngineResult<{ id: string }> => {
      log(
        `engine deleteProfile profile=${validId ? profileId : 'invalid'} outcome=${result.kind} status=${status ?? 'none'}`,
      );
      return result;
    };

    if (!validId) return finish({ kind: 'not-found' });

    if (!deps.url || !deps.apiKey) return finish({ kind: 'unavailable' });

    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      return finish({ kind: 'unavailable' });
    }
    if (!token) return finish({ kind: 'unauthorized' });

    try {
      const response = await doFetch(
        `${deps.url.replace(/\/+$/, '')}/api/profiles/${encodeURIComponent(profileId)}`,
        {
          method: 'DELETE',
          headers: {
            'X-Engine-Key': deps.apiKey,
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
      );
      status = response.status;

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return finish({ kind: 'unavailable' });
      }
      const record = isRecord(body) ? body : {};

      if (status === 200) {
        const data = record.data;
        if (isRecord(data) && typeof data.id === 'string')
          return finish({ kind: 'ok', data: { id: data.id } });
        return finish({ kind: 'unavailable' });
      }
      if (status === 401) return finish({ kind: 'unauthorized' });
      if (status === 404) return finish({ kind: 'not-found' });
      if (status === 409) {
        if (record.code === 'PROFILE_NOT_PUBLISHED')
          return finish({ kind: 'conflict', reason: 'not-published' });
        return finish({ kind: 'unavailable' });
      }
      if (status === 400) {
        const message =
          typeof record.message === 'string' ? record.message : 'Bad request';
        return finish({ kind: 'invalid', message });
      }
      return finish({ kind: 'unavailable' });
    } catch {
      return finish({ kind: 'unavailable' });
    }
  }

  /**
   * The web deploys apart from the engine: an item with no `pausedUntil`
   * (an older engine) is accepted and set to null in place.
   */
  function isSearchSwitchView(data: unknown): data is SearchSwitchView {
    if (
      !isRecord(data) ||
      !(data.key === 'posts' || data.key === 'indeed') ||
      typeof data.enabled !== 'boolean' ||
      typeof data.searches !== 'number'
    )
      return false;
    if (data.pausedUntil === undefined) data.pausedUntil = null;
    return data.pausedUntil === null || typeof data.pausedUntil === 'string';
  }

  function isSearchSwitchList(data: unknown): data is SearchSwitchView[] {
    return Array.isArray(data) && data.every(isSearchSwitchView);
  }

  /** One profile-scoped GET or PUT under `/api/profiles/{id}/{path}`. */
  async function profileSearch<T>(
    name: string,
    profileId: string,
    path: string,
    isValid: (data: unknown) => data is T,
    method: 'GET' | 'PUT',
    enabled?: boolean,
  ): Promise<EngineResult<T>> {
    let status: number | undefined;
    // Not a UUID: the engine would 400 it, and the raw input stays out of the log.
    const validId = UUID.test(profileId);
    const finish = (result: EngineResult<T>): EngineResult<T> => {
      log(
        `engine ${name} profile=${validId ? profileId : 'invalid'} outcome=${result.kind} status=${status ?? 'none'}`,
      );
      return result;
    };

    if (!validId) return finish({ kind: 'not-found' });

    if (!deps.url || !deps.apiKey) return finish({ kind: 'unavailable' });

    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      return finish({ kind: 'unavailable' });
    }
    if (!token) return finish({ kind: 'unauthorized' });

    try {
      const headers: Record<string, string> = {
        'X-Engine-Key': deps.apiKey,
        Authorization: `Bearer ${token}`,
      };
      if (method === 'PUT') headers['Content-Type'] = 'application/json';
      const response = await doFetch(
        `${deps.url.replace(/\/+$/, '')}/api/profiles/${encodeURIComponent(profileId)}/${path}`,
        {
          method,
          headers,
          ...(method === 'PUT' ? { body: JSON.stringify({ enabled }) } : {}),
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
      );
      status = response.status;

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return finish({ kind: 'unavailable' });
      }
      const record = isRecord(body) ? body : {};

      if (status === 200) {
        return isValid(record.data)
          ? finish({ kind: 'ok', data: record.data })
          : finish({ kind: 'unavailable' });
      }
      if (status === 401) return finish({ kind: 'unauthorized' });
      if (status === 403) return finish({ kind: 'forbidden' });
      if (status === 404) return finish({ kind: 'not-found' });
      if (status === 400) {
        const message =
          typeof record.message === 'string' ? record.message : 'Bad request';
        return finish({ kind: 'invalid', message });
      }
      return finish({ kind: 'unavailable' });
    } catch {
      return finish({ kind: 'unavailable' });
    }
  }

  /**
   * One `/api/admin/*` call. `parse` reads the envelope's `data` and returns undefined
   * when it has the wrong shape. Only the call name is logged: author keys and cursors
   * stay out of the log.
   */
  async function admin<T>(
    name: string,
    request: {
      method: 'GET' | 'POST' | 'DELETE';
      path: string;
      body?: unknown;
    },
    parse: (data: unknown, status: number) => T | undefined,
  ): Promise<EngineResult<T>> {
    let status: number | undefined;
    const finish = (result: EngineResult<T>): EngineResult<T> => {
      log(`engine ${name} outcome=${result.kind} status=${status ?? 'none'}`);
      return result;
    };

    if (!deps.url || !deps.apiKey) return finish({ kind: 'unavailable' });

    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      return finish({ kind: 'unavailable' });
    }
    if (!token) return finish({ kind: 'unauthorized' });

    try {
      const headers: Record<string, string> = {
        'X-Engine-Key': deps.apiKey,
        Authorization: `Bearer ${token}`,
      };
      const hasBody = request.body !== undefined;
      if (hasBody) headers['Content-Type'] = 'application/json';
      const response = await doFetch(
        `${deps.url.replace(/\/+$/, '')}/api${request.path}`,
        {
          method: request.method,
          headers,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
      );
      status = response.status;

      // 204 has no body to read.
      if (status === 204) {
        const data = parse(null, status);
        return data === undefined
          ? finish({ kind: 'unavailable' })
          : finish({ kind: 'ok', data });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return finish({ kind: 'unavailable' });
      }
      const record = isRecord(body) ? body : {};

      if (status === 200 || status === 201) {
        const data = parse(record.data, status);
        return data === undefined
          ? finish({ kind: 'unavailable' })
          : finish({ kind: 'ok', data });
      }
      if (status === 401) return finish({ kind: 'unauthorized' });
      if (status === 403) return finish({ kind: 'forbidden' });
      if (status === 404) return finish({ kind: 'not-found' });
      if (status === 400) {
        const message =
          typeof record.message === 'string' ? record.message : 'Bad request';
        return finish({ kind: 'invalid', message });
      }
      return finish({ kind: 'unavailable' });
    } catch {
      return finish({ kind: 'unavailable' });
    }
  }

  async function forwardWebhookCallback(input: {
    body: Uint8Array;
    headers: Record<CallbackHeader, string | null>;
    contentType?: string | null;
  }): Promise<{ status: number; body: string } | { kind: 'unavailable' }> {
    let status: number | undefined;
    const finish = <T>(result: T, outcome: string): T => {
      // Status only: the body, signature and secret never reach the log.
      log(
        `engine forwardWebhookCallback outcome=${outcome} status=${status ?? 'none'}`,
      );
      return result;
    };
    if (!deps.url || !deps.apiKey)
      return finish({ kind: 'unavailable' as const }, 'unavailable');
    const headers: Record<string, string> = {
      'X-Engine-Key': deps.apiKey,
      'Content-Type': input.contentType || 'application/json',
    };
    for (const [name, value] of Object.entries(input.headers))
      if (value !== null) headers[name] = value;
    try {
      const response = await doFetch(`${deps.url}/api/webhooks/callback`, {
        method: 'POST',
        headers,
        body: input.body as unknown as ArrayBuffer,
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      status = response.status;
      const body = await response.text();
      return finish({ status: response.status, body }, 'relayed');
    } catch {
      return finish({ kind: 'unavailable' as const }, 'unavailable');
    }
  }

  return {
    forwardWebhookCallback,
    publishProfile,
    deleteProfile,
    searchesState: () =>
      admin(
        'searchesState',
        { method: 'GET', path: '/me/searches' },
        parseSearchesState,
      ),
    resumeSearches: () =>
      admin(
        'resumeSearches',
        { method: 'POST', path: '/me/searches/resume' },
        parseSearchesState,
      ),
    adminMe: () =>
      admin('adminMe', { method: 'GET', path: '/admin/me' }, (data) =>
        isRecord(data) && typeof data.admin === 'boolean'
          ? { admin: data.admin }
          : undefined,
      ),
    prepareDrops: (options = {}) =>
      admin(
        'prepareDrops',
        {
          method: 'GET',
          path: `/admin/prepare/drops${queryOf({
            rule: options.rule,
            before: options.before,
            limit: options.limit,
          })}`,
        },
        pageOf(isDropView),
      ),
    silencedPosts: (options = {}) =>
      admin(
        'silencedPosts',
        {
          method: 'GET',
          path: `/admin/prepare/silenced-posts${queryOf({
            before: options.before,
            limit: options.limit,
          })}`,
        },
        pageOf(isHeldPostView),
      ),
    extractVerdicts: (options = {}) =>
      admin(
        'extractVerdicts',
        {
          method: 'GET',
          path: `/admin/extract/verdicts${queryOf({
            verdict: options.verdict,
            reason: options.reason,
            before: options.before,
            limit: options.limit,
          })}`,
        },
        pageOf(isVerdictView),
      ),
    adminRescues: (options = {}) =>
      admin(
        'adminRescues',
        {
          method: 'GET',
          path: `/admin/rescues${queryOf({ limit: options.limit })}`,
        },
        (data) =>
          isRecord(data) &&
          Array.isArray(data.items) &&
          data.items.every(isRescueView)
            ? { items: data.items }
            : undefined,
      ),
    adminPostsBudget: () =>
      admin(
        'adminPostsBudget',
        { method: 'GET', path: '/admin/posts-budget' },
        (data) => (isPostsBudgetView(data) ? data : undefined),
      ),
    autoSilenceCandidates: () =>
      admin(
        'autoSilenceCandidates',
        { method: 'GET', path: '/admin/extract/auto-silence-candidates' },
        (data) =>
          Array.isArray(data) && data.every(isAutoSilenceCandidateView)
            ? data
            : undefined,
      ),
    silencedAuthors: () =>
      admin(
        'silencedAuthors',
        { method: 'GET', path: '/admin/silenced-authors' },
        (data) =>
          Array.isArray(data) && data.every(isSilencedAuthorView)
            ? data
            : undefined,
      ),
    silenceAuthor: (input) =>
      admin(
        'silenceAuthor',
        {
          method: 'POST',
          path: '/admin/silenced-authors',
          body: {
            authorKey: input.authorKey,
            ...(input.name ? { name: input.name } : {}),
            reason: input.reason,
          },
        },
        (data, status) =>
          status === 201 && isRecord(data) && data.status === 'silenced'
            ? { status: 'silenced' as const }
            : status === 200 && isRecord(data) && data.status === 'already'
              ? { status: 'already' as const }
              : undefined,
      ),
    unsilenceAuthor: (authorKey) =>
      admin(
        'unsilenceAuthor',
        {
          method: 'DELETE',
          path: `/admin/silenced-authors/${encodeURIComponent(authorKey)}`,
        },
        (_data, status) => (status === 204 ? null : undefined),
      ),
    searchSwitches: (profileId) =>
      profileSearch(
        'searchSwitches',
        profileId,
        'searches',
        isSearchSwitchList,
        'GET',
      ),
    setSearchSwitch: (profileId, key, enabled) =>
      profileSearch(
        'setSearchSwitch',
        profileId,
        `searches/${encodeURIComponent(key)}`,
        isSearchSwitchView,
        'PUT',
        enabled,
      ),
  };
}
