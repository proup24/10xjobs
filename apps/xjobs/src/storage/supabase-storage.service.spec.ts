import {
  StorageObjectNotFoundError,
  type StorageClient,
} from './storage.service';
import { SupabaseStorageService } from './supabase-storage.service';

type Call = [string, ...unknown[]];

/** A stand-in for `supabase.storage` that records calls and replays canned results. */
function fakeClient(results: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const result = (name: string) =>
    results[name] ?? { data: {}, error: null };
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

const apiError = (status: number, message = 'failed') => ({
  data: null,
  error: Object.assign(new Error(message), { status, statusCode: String(status) }),
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

  it('creates a missing bucket as private', async () => {
    const { calls, client } = fakeClient({ getBucket: apiError(404) });
    await new SupabaseStorageService(client).ensureBucket('resumes');
    expect(calls).toContainEqual(['createBucket', 'resumes', { public: false }]);
  });

  it('leaves an existing bucket alone', async () => {
    const { calls, client } = fakeClient({
      getBucket: { data: { id: 'resumes' }, error: null },
    });
    await new SupabaseStorageService(client).ensureBucket('resumes');
    expect(calls.map(([name]) => name)).toEqual(['getBucket']);
  });
});
