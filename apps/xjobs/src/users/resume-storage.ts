import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** Injection token and contract for where resume files live. */
export abstract class ResumeStorage {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  /** Removing a key that does not exist is not an error. */
  abstract delete(key: string): Promise<void>;
}

/** Stores each resume as a file under `rootDir`, at the path its key names. */
export class LocalResumeStorage extends ResumeStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Resume key escapes the storage directory: ${key}`);
    }
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
