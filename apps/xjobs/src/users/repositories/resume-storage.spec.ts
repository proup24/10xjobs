import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalResumeStorage } from './resume-storage';

describe('LocalResumeStorage', () => {
  let root: string;
  let storage: LocalResumeStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'resumes-'));
    storage = new LocalResumeStorage(root);
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('round-trips a file under nested directories', async () => {
    await storage.put('ws/profile/a.pdf', Buffer.from('%PDF-1.7'));
    expect((await storage.get('ws/profile/a.pdf')).toString()).toBe('%PDF-1.7');
  });

  it('cannot read a deleted file', async () => {
    await storage.put('ws/profile/a.pdf', Buffer.from('%PDF-1.7'));
    await storage.delete('ws/profile/a.pdf');
    await expect(storage.get('ws/profile/a.pdf')).rejects.toThrow();
  });

  it('deleting a missing file is a no-op', async () => {
    await expect(storage.delete('ws/profile/none.pdf')).resolves.toBeUndefined();
  });

  it('refuses a key outside its root', async () => {
    await expect(
      storage.put('../escape.pdf', Buffer.from('%PDF-1.7')),
    ).rejects.toThrow();
  });
});
