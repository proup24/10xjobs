import { StorageObjectNotFoundError, StorageService } from '../storage.service';

/** In-memory `StorageService` for unit tests; not part of the application build. */
export class MemoryStorageService extends StorageService {
  objects = new Map<string, Map<string, Buffer>>();
  buckets: string[] = [];
  failNextPut = false;
  failNextDelete = false;

  keys(bucket: string): string[] {
    return [...(this.objects.get(bucket)?.keys() ?? [])];
  }

  async put(bucket: string, key: string, data: Buffer): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('storage unavailable');
    }
    const objects = this.objects.get(bucket) ?? new Map<string, Buffer>();
    if (objects.has(key)) throw new Error(`${bucket}/${key} already exists`);
    objects.set(key, data);
    this.objects.set(bucket, objects);
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const data = this.objects.get(bucket)?.get(key);
    if (!data) throw new StorageObjectNotFoundError(bucket, key);
    return data;
  }

  async delete(bucket: string, key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error('storage unavailable');
    }
    this.objects.get(bucket)?.delete(key);
  }

  async ensureBucket(bucket: string): Promise<void> {
    if (!this.buckets.includes(bucket)) this.buckets.push(bucket);
  }
}
