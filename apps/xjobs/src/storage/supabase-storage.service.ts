import {
  StorageObjectNotFoundError,
  StorageService,
  type StorageClient,
} from './storage.service';

type StorageFailure = {
  message: string;
  status?: number;
  statusCode?: string;
  code?: string;
};

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
      throw new Error(`Storage upload to ${bucket}/${key} failed: ${error.message}`);
    }
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.client.from(bucket).download(key);
    if (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(bucket, key);
      throw new Error(`Storage download of ${bucket}/${key} failed: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(bucket: string, key: string): Promise<void> {
    const { error } = await this.client.from(bucket).remove([key]);
    if (error && !isNotFound(error)) {
      throw new Error(`Storage removal of ${bucket}/${key} failed: ${error.message}`);
    }
  }

  async ensureBucket(bucket: string): Promise<void> {
    const found = await this.client.getBucket(bucket);
    if (!found.error) return;
    if (!isNotFound(found.error)) {
      throw new Error(`Storage bucket ${bucket} lookup failed: ${found.error.message}`);
    }
    const created = await this.client.createBucket(bucket, { public: false });
    if (created.error && !isAlreadyExists(created.error)) {
      throw new Error(`Storage bucket ${bucket} creation failed: ${created.error.message}`);
    }
  }
}
