/** Thrown by `StorageService.get` when the bucket has no object at that key. */
export class StorageObjectNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`No object at ${bucket}/${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/**
 * @description Injection token and contract for object storage. Modules
 * depend on this, never on the Supabase client, so the backend can change.
 */
export abstract class StorageService {
  /** Stores `data` at `key`; fails if an object already exists there. */
  abstract put(
    bucket: string,
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void>;
  /** Reads the object at `key`, or throws `StorageObjectNotFoundError`. */
  abstract get(bucket: string, key: string): Promise<Buffer>;
  /** Removes the object at `key`; a missing object is not an error. */
  abstract delete(bucket: string, key: string): Promise<void>;
  /** Creates `bucket` as private when it does not exist yet. */
  abstract ensureBucket(bucket: string): Promise<void>;
}
