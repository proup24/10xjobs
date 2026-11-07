import { StorageObjectNotFoundError, StorageService } from './storage.service';
import type { StorageClient, StorageFailure } from '../types';

/** Supabase reports a missing object or bucket as 404, in `status` or `statusCode`. */
function isNotFound(error: StorageFailure): boolean {
  return (
    error.status === 404 ||
    error.statusCode === '404' ||
    error.code === 'NoSuchKey' ||
    error.code === 'NoSuchBucket'
  );
}

function isAlreadyExists(error: StorageFailure): boolean {
  return (
    error.status === 409 ||
    error.statusCode === '409' ||
    error.code === 'ResourceAlreadyExists'
  );
}

/** Supabase Storage's default and our page size for `list`. */
const LIST_PAGE = 100;

/** `StorageService` on Supabase Storage, called with the service-role key. */
export class SupabaseStorageService extends StorageService {
  constructor(private readonly client: StorageClient) {
    super();
  }

  async put(
    bucket: string,
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.client
      .from(bucket)
      .upload(key, data, { contentType, upsert: false });
    if (error) {
      throw new Error(
        `Storage upload to ${bucket}/${key} failed: ${error.message}`,
      );
    }
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.client.from(bucket).download(key);
    if (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(bucket, key);
      throw new Error(
        `Storage download of ${bucket}/${key} failed: ${error.message}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(bucket: string, key: string): Promise<void> {
    const { error } = await this.client.from(bucket).remove([key]);
    if (error && !isNotFound(error)) {
      throw new Error(
        `Storage removal of ${bucket}/${key} failed: ${error.message}`,
      );
    }
  }

  async deletePrefix(bucket: string, prefix: string): Promise<void> {
    if (!prefix)
      throw new Error(`Refusing to delete ${bucket} under an empty prefix`);
    const keys = await this.listKeys(bucket, prefix);
    for (let i = 0; i < keys.length; i += LIST_PAGE) {
      const batch = keys.slice(i, i + LIST_PAGE);
      const { error } = await this.client.from(bucket).remove(batch);
      if (error && !isNotFound(error)) {
        throw new Error(
          `Storage removal under ${bucket}/${prefix}/ failed: ${error.message}`,
        );
      }
    }
  }

  /** Every file key under `folder/`, collected before anything is removed so paging stays stable. */
  private async listKeys(bucket: string, folder: string): Promise<string[]> {
    const keys: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await this.client
        .from(bucket)
        .list(folder, { limit: LIST_PAGE, offset });
      if (error) {
        if (isNotFound(error)) return keys;
        throw new Error(
          `Storage listing of ${bucket}/${folder}/ failed: ${error.message}`,
        );
      }
      for (const entry of data) {
        const key = `${folder}/${entry.name}`;
        // Folders come back with no id.
        if (entry.id == null) keys.push(...(await this.listKeys(bucket, key)));
        else keys.push(key);
      }
      if (data.length < LIST_PAGE) return keys;
    }
  }

  async ensureBucket(bucket: string): Promise<void> {
    const found = await this.client.getBucket(bucket);
    if (!found.error) return;
    if (!isNotFound(found.error)) {
      throw new Error(
        `Storage bucket ${bucket} lookup failed: ${found.error.message}`,
      );
    }
    const created = await this.client.createBucket(bucket, { public: false });
    if (created.error && !isAlreadyExists(created.error)) {
      throw new Error(
        `Storage bucket ${bucket} creation failed: ${created.error.message}`,
      );
    }
  }
}
