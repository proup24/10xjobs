import { StorageObjectNotFoundError } from './storage.service';
import { SupabaseStorageService } from './supabase-storage.service';
import type { StorageClient } from '../types';

type Call = [string, ...unknown[]];

/** A stand-in for `supabase.storage` that records calls and replays canned results. */
function fakeClient(
  results: Record<string, unknown> = {},
  keys: string[] = [],
) {
  const calls: Call[] = [];
  const result = (name: string) => results[name] ?? { data: {}, error: null };
  const client = {
    from: (bucket: string) => ({
      upload: async (...args: unknown[]) => {
        calls.push(['upload', bucket, ...args]);
        return result('upload');
      },
      download: async (...args: unknown[]) => {
        calls.push(['download', bucket, ...args]);
        return result('download');
      },
      list: async (
        path: string,
        options: { limit: number; offset: number },
      ) => {
        calls.push(['list', bucket, path, options]);
        if (results['list']) return results['list'];
        return { data: listing(keys, path, options), error: null };
      },
      remove: async (...args: unknown[]) => {
        calls.push(['remove', bucket, ...args]);
        return result('remove');
      },
    }),
    getBucket: async (...args: unknown[]) => {
      calls.push(['getBucket', ...args]);
      return result('getBucket');
    },
    createBucket: async (...args: unknown[]) => {
      calls.push(['createBucket', ...args]);
      return result('createBucket');
    },
  };
  return { calls, client: client as unknown as StorageClient };
}

/**
 * Supabase Storage's `list`: the direct children of `path`, sorted by name,
 * files with an id and folders with `id: null`, one page at a time.
 */
function listing(
  keys: string[],
  path: string,
  { limit, offset }: { limit: number; offset: number },
) {
  const children = new Map<string, boolean>();
  for (const key of keys) {
    if (!key.startsWith(`${path}/`)) continue;
    const [name, ...below] = key.slice(path.length + 1).split('/');
    children.set(name, (children.get(name) ?? false) || below.length > 0);
  }
  return [...children]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(offset, offset + limit)
    .map(([name, isFolder]) => ({ name, id: isFolder ? null : `id-${name}` }));
}

/** Every key passed to `remove`, across calls. */
const removed = (calls: Call[]) =>
  calls
    .filter(([name]) => name === 'remove')
    .flatMap(([, , paths]) => paths as string[]);

const apiError = (status: number, message = 'failed') => ({
  data: null,
  error: Object.assign(new Error(message), {
    status,
    statusCode: String(status),
  }),
});

describe('SupabaseStorageService', () => {
  it('uploads without overwriting, with the content type', async () => {
    const { calls, client } = fakeClient();
    const data = Buffer.from('%PDF-1.7');
    await new SupabaseStorageService(client).put(
      'resumes',
      'ws/p/a.pdf',
      data,
      'application/pdf',
    );
    expect(calls).toEqual([
      [
        'upload',
        'resumes',
        'ws/p/a.pdf',
        data,
        { contentType: 'application/pdf', upsert: false },
      ],
    ]);
  });

  it('throws when an upload fails', async () => {
    const { client } = fakeClient({ upload: apiError(500, 'disk full') });
    await expect(
      new SupabaseStorageService(client).put('b', 'k', Buffer.from('x'), 'x/y'),
    ).rejects.toThrow('disk full');
  });

  it('returns a downloaded object as a Buffer', async () => {
    const { client } = fakeClient({
      download: { data: new Blob(['%PDF-1.7']), error: null },
    });
    const data = await new SupabaseStorageService(client).get('b', 'k');
    expect(data.toString()).toBe('%PDF-1.7');
  });

  it('maps a missing object to StorageObjectNotFoundError', async () => {
    const { client } = fakeClient({ download: apiError(404, 'not found') });
    await expect(
      new SupabaseStorageService(client).get('b', 'k'),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('removes an object by key', async () => {
    const { calls, client } = fakeClient();
    await new SupabaseStorageService(client).delete('b', 'k');
    expect(calls).toEqual([['remove', 'b', ['k']]]);
  });

  it('deletePrefix removes every key under the prefix', async () => {
    const keys = ['u/p/a.pdf', 'u/p/b.pdf'];
    const { calls, client } = fakeClient({}, [
      ...keys,
      'u/q/c.pdf',
      'u/pp/d.pdf',
    ]);
    await new SupabaseStorageService(client).deletePrefix('resumes', 'u/p');
    expect(removed(calls).sort()).toEqual(keys);
    expect(
      calls.filter(([n]) => n === 'remove').every(([, b]) => b === 'resumes'),
    ).toBe(true);
  });

  it('deletePrefix tolerates an empty or missing folder', async () => {
    const { calls, client } = fakeClient();
    await new SupabaseStorageService(client).deletePrefix('resumes', 'u/p');
    expect(removed(calls)).toEqual([]);
    const missing = fakeClient({ list: apiError(404, 'not found') });
    await expect(
      new SupabaseStorageService(missing.client).deletePrefix('resumes', 'u/p'),
    ).resolves.toBeUndefined();
  });

  it('deletePrefix pages through more than 100 objects', async () => {
    const keys = Array.from(
      { length: 250 },
      (_, i) => `u/p/${String(i).padStart(3, '0')}.pdf`,
    );
    const { calls, client } = fakeClient({}, keys);
    await new SupabaseStorageService(client).deletePrefix('resumes', 'u/p');
    expect(removed(calls).sort()).toEqual(keys);
    const offsets = calls
      .filter(([name]) => name === 'list')
      .map(([, , , options]) => (options as { offset: number }).offset);
    expect(offsets).toEqual([0, 100, 200]);
  });

  it('deletePrefix recurses into nested folders', async () => {
    const keys = ['u/p/a.pdf', 'u/p/old/b.pdf', 'u/p/old/deeper/c.pdf'];
    const { calls, client } = fakeClient({}, keys);
    await new SupabaseStorageService(client).deletePrefix('resumes', 'u');
    expect(removed(calls).sort()).toEqual(keys);
  });

  it('deletePrefix refuses an empty prefix rather than clearing the bucket', async () => {
    const { calls, client } = fakeClient({}, ['u/p/a.pdf']);
    await expect(
      new SupabaseStorageService(client).deletePrefix('resumes', ''),
    ).rejects.toThrow(/empty prefix/);
    expect(calls).toEqual([]);
  });

  it('deletePrefix throws when listing fails', async () => {
    const { client } = fakeClient({ list: apiError(500, 'list broke') });
    await expect(
      new SupabaseStorageService(client).deletePrefix('resumes', 'u/p'),
    ).rejects.toThrow('list broke');
  });

  it('deletePrefix throws when removal fails', async () => {
    const { client } = fakeClient({ remove: apiError(500, 'remove broke') }, [
      'u/p/a.pdf',
    ]);
    await expect(
      new SupabaseStorageService(client).deletePrefix('resumes', 'u/p'),
    ).rejects.toThrow('remove broke');
  });

  it('creates a missing bucket as private', async () => {
    const { calls, client } = fakeClient({ getBucket: apiError(404) });
    await new SupabaseStorageService(client).ensureBucket('resumes');
    expect(calls).toContainEqual([
      'createBucket',
      'resumes',
      { public: false },
    ]);
  });

  it('leaves an existing bucket alone', async () => {
    const { calls, client } = fakeClient({
      getBucket: { data: { id: 'resumes' }, error: null },
    });
    await new SupabaseStorageService(client).ensureBucket('resumes');
    expect(calls.map(([name]) => name)).toEqual(['getBucket']);
  });
});
