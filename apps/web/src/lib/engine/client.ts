// Deliberately no `server-only` import, so this file can be unit tested and
// exercised by the engine e2e suite. The engine key is read only in
// `server.ts`, which does have `server-only`, and handed in through `deps`.
export type PublishedProfile = { id: string; state: string };

export type EngineResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not-found' }
  | { kind: 'conflict'; reason: 'already-published' | 'incomplete' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unauthorized' }
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
}

const DEFAULT_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  return { publishProfile };
}
