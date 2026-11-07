import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  pdfBytes,
  publishProfile,
  resumeKeyFor,
  seedProfile,
} from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const PDF = { contentType: 'application/pdf' };
const SHA = 'a'.repeat(64);
const RESUME_COLUMNS = [
  'resumeKey',
  'resumeFilename',
  'resumeSizeBytes',
  'resumeSha256',
  'resumeUploadedAt',
  'updatedAt',
];

describe('set_profile_resume', () => {
  let a: TestUser;
  let b: TestUser;
  let aDraft: string;
  let aOther: string;
  let aPub: string;
  let bDraft: string;

  const row = async (id: string) => {
    const { data, error } = await admin()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  };

  const upload = async (user: TestUser, profileId: string, size = 1024) => {
    const key = resumeKeyFor(user.id, profileId);
    const { error } = await user.client.storage
      .from('resumes')
      .upload(key, pdfBytes(size), PDF);
    if (error) throw new Error(error.message);
    return key;
  };

  const swap = (
    user: TestUser,
    profileId: string,
    key: string,
    filename = 'cv.pdf',
    sha256 = SHA,
  ) =>
    user.client.rpc('set_profile_resume', {
      profile_id: profileId,
      key,
      filename,
      sha256,
    });

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    aDraft = await seedProfile(a.id);
    aOther = await seedProfile(a.id);
    aPub = await seedProfile(a.id);
    await publishProfile(aPub);
    bDraft = await seedProfile(b.id);
  });

  it("sets the columns on A's draft", async () => {
    const key = await upload(a, aDraft);
    const { data, error } = await swap(a, aDraft, key);
    expect(error).toBeNull();
    expect(data).toBeNull();
    const r = await row(aDraft);
    expect(r.resumeKey).toBe(key);
    expect(r.resumeFilename).toBe('cv.pdf');
    expect(r.resumeSizeBytes).toBe(1024);
    expect(r.resumeSha256).toBe(SHA);
    const age = Date.now() - new Date(r.resumeUploadedAt as string).getTime();
    expect(Math.abs(age)).toBeLessThan(10_000);
  });

  it("sets the columns on A's published profile", async () => {
    const before = await row(aPub);
    const key = await upload(a, aPub);
    const { error } = await swap(a, aPub, key);
    expect(error).toBeNull();
    const after = await row(aPub);
    expect(after.state).toBe('published');
    expect(after.resumeKey).toBe(key);
    expect(after.resumeFilename).toBe('cv.pdf');
    expect(after.resumeSizeBytes).toBe(1024);
    expect(after.resumeSha256).toBe(SHA);
    const strip = (r: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !RESUME_COLUMNS.includes(k)),
      );
    expect(strip(after)).toEqual(strip(before));
  });

  it('returns the previous key on replace', async () => {
    const first = await upload(a, aOther);
    expect((await swap(a, aOther, first)).data).toBeNull();
    const second = await upload(a, aOther);
    const { data, error } = await swap(a, aOther, second);
    expect(error).toBeNull();
    expect(data).toBe(first);
    expect((await row(aOther)).resumeKey).toBe(second);
  });

  it('takes the size from Storage', async () => {
    const key = await upload(a, aDraft, 3000);
    const { error } = await swap(a, aDraft, key);
    expect(error).toBeNull();
    expect((await row(aDraft)).resumeSizeBytes).toBe(3000);
  });

  it("refuses B's profile", async () => {
    const before = await row(bDraft);
    const key = await upload(a, aDraft);
    const { error } = await swap(a, bDraft, key);
    expect(error?.code).toBe('42501');
    expect(await row(bDraft)).toEqual(before);
  });

  describe('bad input leaves the row unchanged', () => {
    // Objects are real, so only the check under test can refuse the key.
    const adminUpload = async (key: string) => {
      const { error } = await admin()
        .storage.from('resumes')
        .upload(key, pdfBytes(), PDF);
      if (error) throw new Error(error.message);
      return key;
    };
    const cases: [
      string,
      () => Promise<{ error: { code?: string; message: string } | null }>,
      RegExp,
    ][] = [
      [
        "B's real file in B's folder",
        async () => swap(a, aDraft, await upload(b, bDraft)),
        /your folder/,
      ],
      [
        "a key in B's folder with A's profile id",
        async () =>
          swap(a, aDraft, await adminUpload(resumeKeyFor(b.id, aDraft))),
        /your folder/,
      ],
      [
        "a key for another of A's profiles",
        async () => swap(a, aDraft, await upload(a, aOther)),
        /another profile/,
      ],
      [
        'a key with the wrong layout',
        async () =>
          swap(a, aDraft, await adminUpload(`${a.id}/${aDraft}/cv.pdf`)),
        /your folder/,
      ],
      [
        'a key with no object',
        async () => swap(a, aDraft, resumeKeyFor(a.id, aDraft)),
        /no uploaded file/,
      ],
      [
        'a bad sha256',
        async () =>
          swap(a, aDraft, await upload(a, aDraft), 'cv.pdf', 'A'.repeat(64)),
        /sha256/,
      ],
      [
        'a short sha256',
        async () => swap(a, aDraft, await upload(a, aDraft), 'cv.pdf', 'ab'),
        /sha256/,
      ],
    ];
    for (const [name, run, message] of cases) {
      it(`refuses ${name}`, async () => {
        const before = await row(aDraft);
        const { error } = await run();
        expect(error?.code).toBe('23514');
        expect(error?.message).toMatch(message);
        expect(await row(aDraft)).toEqual(before);
      });
    }
  });

  it('cleans the filename', async () => {
    const long = 'x'.repeat(300);
    const expected: [string, string][] = [
      ['../../x/évil<script>.pdf', '_vil_script_.pdf'],
      ['', 'resume.pdf'],
      [long, 'x'.repeat(200)],
    ];
    for (const [input, out] of expected) {
      const key = await upload(a, aDraft);
      const { error } = await swap(a, aDraft, key, input);
      expect(error).toBeNull();
      const r = await row(aDraft);
      expect(r.resumeFilename).toBe(out);
      expect(r.resumeKey).toBe(key);
    }
  });

  it('the error message never contains the filename', async () => {
    const { error } = await swap(
      a,
      aDraft,
      resumeKeyFor(a.id, aDraft),
      'secret-name.pdf',
    );
    expect(error?.message).toContain('set_profile_resume');
    expect(error?.message).not.toContain('secret-name');
  });

  it('anon cannot call it', async () => {
    const { error } = await anon().rpc('set_profile_resume', {
      profile_id: aDraft,
      key: resumeKeyFor(a.id, aDraft),
      filename: 'cv.pdf',
      sha256: SHA,
    });
    expect(error).not.toBeNull();
  });
});
