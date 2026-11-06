import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  pdfBytes,
  publishProfile,
  resumeKeyFor,
  seedProfile,
} from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const PDF = { contentType: 'application/pdf' };

describe('resume storage policies', () => {
  let a: TestUser;
  let b: TestUser;
  let aDraft: string;
  let aPub: string;
  let bDraft: string;

  const adminList = async (folder: string) => {
    const { data, error } = await admin().storage.from('resumes').list(folder);
    if (error) throw new Error(error.message);
    return data;
  };

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    aDraft = await seedProfile(a.id);
    aPub = await seedProfile(a.id);
    await publishProfile(aPub);
    bDraft = await seedProfile(b.id);
  });

  it('bucket row has the agreed limits', async () => {
    const rows = await withCatalog(
      async (c) =>
        (
          await c.query(
            `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'`,
          )
        ).rows,
    );
    expect(rows).toEqual([
      {
        public: false,
        file_size_limit: '5242880', // bigint comes back as a string
        allowed_mime_types: ['application/pdf'],
      },
    ]);
  });

  it("A uploads, lists, downloads and deletes in A's own folder", async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const bucket = a.client.storage.from('resumes');
    const up = await bucket.upload(key, pdfBytes(), PDF);
    expect(up.error).toBeNull();

    const listed = await bucket.list(`${a.id}/${aDraft}`);
    expect(listed.error).toBeNull();
    expect(listed.data?.map((o) => o.name)).toContain(key.split('/')[2]);

    const down = await bucket.download(key);
    expect(down.error).toBeNull();
    expect(down.data?.size).toBe(1024);

    const removed = await bucket.remove([key]);
    expect(removed.error).toBeNull();
    expect(await adminList(`${a.id}/${aDraft}`)).toEqual([]);
  });

  it("A cannot upload into B's folder", async () => {
    const { error } = await a.client.storage
      .from('resumes')
      .upload(resumeKeyFor(b.id, bDraft), pdfBytes(), PDF);
    expect(error).not.toBeNull();
    expect(await adminList(`${b.id}/${bDraft}`)).toEqual([]);
  });

  it("A cannot upload into A's folder under B's profile", async () => {
    const { error } = await a.client.storage
      .from('resumes')
      .upload(resumeKeyFor(a.id, bDraft), pdfBytes(), PDF);
    expect(error).not.toBeNull();
    expect(await adminList(`${a.id}/${bDraft}`)).toEqual([]);
  });

  it('A cannot upload a key with the wrong layout', async () => {
    const bucket = a.client.storage.from('resumes');
    for (const key of [
      `${a.id}/${aDraft}/cv.pdf`,
      `${a.id}/x.pdf`,
      `${a.id}/${aDraft}/${randomUUID()}.txt`,
    ]) {
      const { error } = await bucket.upload(key, pdfBytes(), PDF);
      expect(error, key).not.toBeNull();
    }
    expect(await adminList(`${a.id}/${aDraft}`)).toEqual([]);
  });

  it("A cannot read, list or delete B's file", async () => {
    const key = resumeKeyFor(b.id, bDraft);
    const up = await b.client.storage
      .from('resumes')
      .upload(key, pdfBytes(), PDF);
    expect(up.error).toBeNull();

    const bucket = a.client.storage.from('resumes');
    expect((await bucket.download(key)).error).not.toBeNull();
    const listed = await bucket.list(`${b.id}/${bDraft}`);
    expect(listed.data ?? []).toEqual([]);
    await bucket.remove([key]);
    expect(await adminList(`${b.id}/${bDraft}`)).toHaveLength(1);
  });

  it('no one can overwrite', async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const bucket = a.client.storage.from('resumes');
    expect((await bucket.upload(key, pdfBytes(1024), PDF)).error).toBeNull();

    const again = await bucket.upload(key, pdfBytes(2048), {
      ...PDF,
      upsert: true,
    });
    expect(again.error).not.toBeNull();

    const original = await admin().storage.from('resumes').download(key);
    expect(original.data?.size).toBe(1024);
  });

  it('the bucket refuses a non-PDF type', async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const { error } = await a.client.storage
      .from('resumes')
      .upload(key, pdfBytes(), { contentType: 'text/plain' });
    expect(error).not.toBeNull();
    const names = (await adminList(`${a.id}/${aDraft}`)).map((o) => o.name);
    expect(names).not.toContain(key.split('/')[2]);
  });

  it('the bucket refuses a file over 5 MiB', async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const { error } = await a.client.storage
      .from('resumes')
      .upload(key, pdfBytes(5_242_881), PDF);
    expect(error).not.toBeNull();
    const names = (await adminList(`${a.id}/${aDraft}`)).map((o) => o.name);
    expect(names).not.toContain(key.split('/')[2]);
  });

  it('A cannot delete the live file of a published profile', async () => {
    const key = resumeKeyFor(a.id, aPub);
    const bucket = a.client.storage.from('resumes');
    expect((await bucket.upload(key, pdfBytes(), PDF)).error).toBeNull();
    const set = await admin()
      .from('profiles')
      .update({ resumeKey: key })
      .eq('id', aPub);
    expect(set.error).toBeNull();

    await bucket.remove([key]);
    const names = (await adminList(`${a.id}/${aPub}`)).map((o) => o.name);
    expect(names).toContain(key.split('/')[2]);
  });

  it('A can delete the live file of a draft', async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const bucket = a.client.storage.from('resumes');
    expect((await bucket.upload(key, pdfBytes(), PDF)).error).toBeNull();
    const set = await admin()
      .from('profiles')
      .update({ resumeKey: key })
      .eq('id', aDraft);
    expect(set.error).toBeNull();

    await bucket.remove([key]);
    const names = (await adminList(`${a.id}/${aDraft}`)).map((o) => o.name);
    expect(names).not.toContain(key.split('/')[2]);
  });

  it('anon cannot read or upload', async () => {
    const key = resumeKeyFor(a.id, aDraft);
    const bucket = anon().storage.from('resumes');
    expect((await bucket.upload(key, pdfBytes(), PDF)).error).not.toBeNull();
    const listed = await bucket.list(`${b.id}/${bDraft}`);
    expect(listed.data ?? []).toEqual([]);
    expect(await adminList(`${b.id}/${bDraft}`)).toHaveLength(1);
  });
});
