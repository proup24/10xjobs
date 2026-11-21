import { randomUUID } from 'node:crypto';
import axios from 'axios';
import {
  createAuthUser,
  deleteAuthUser,
  admin,
  setEligibility,
} from '../support/auth-users';
import { createDraftProfile } from '../support/profiles';

const call = (
  method: 'POST' | 'DELETE',
  path: string,
  opts: { key?: boolean; token?: string } = {},
) => {
  const headers: Record<string, string> = {};
  if (opts.key !== false)
    headers['X-Engine-Key'] = process.env.ENGINE_API_KEY ?? '';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  return fetch(`${axios.defaults.baseURL}/api/profiles/${path}`, {
    method,
    headers,
  });
};

const exists = async (id: string) => {
  const { data, error } = await admin()
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
};

const resumes = () => admin().storage.from('resumes');

/** File names in a profile's resume folder, read with the service role. */
const folderFiles = async (folder: string) => {
  const { data, error } = await resumes().list(folder);
  if (error) throw new Error(error.message);
  return data.map((entry) => entry.name);
};

describe('DELETE /api/profiles/:profileId', () => {
  let a: { id: string; accessToken: string };
  let b: { id: string; accessToken: string };
  let published: string;
  let draft: string;

  beforeAll(async () => {
    a = await createAuthUser('delete-a');
    b = await createAuthUser('delete-b');
    await setEligibility(a.id);
    published = await createDraftProfile(a.id);
    draft = await createDraftProfile(a.id);
    const res = await call('POST', `${published}/publish`, {
      token: a.accessToken,
    });
    expect(res.status).toBe(200);
    // The live file a published profile keeps, which the user's own Storage
    // policy may not delete: the engine must remove it.
    const { error } = await resumes().upload(
      `${a.id}/${published}/${randomUUID()}.pdf`,
      Buffer.from('%PDF-1.7\n%%EOF\n'),
      { contentType: 'application/pdf', upsert: false },
    );
    if (error) throw new Error(`Could not upload a resume: ${error.message}`);
  });

  afterAll(async () => {
    // Left behind only if the delete test failed.
    if (a && published) {
      const folder = `${a.id}/${published}`;
      const names = await folderFiles(folder);
      if (names.length)
        await resumes().remove(names.map((name) => `${folder}/${name}`));
    }
    for (const id of [a?.id, b?.id].filter(Boolean)) await deleteAuthUser(id);
  });

  it('401s without the key', async () => {
    const res = await call('DELETE', published, {
      key: false,
      token: a.accessToken,
    });
    expect(res.status).toBe(401);
  });

  it('401s with the key but no token', async () => {
    expect((await call('DELETE', published)).status).toBe(401);
  });

  it("404s B's token on A's published profile, which stays", async () => {
    const res = await call('DELETE', published, { token: b.accessToken });
    expect(res.status).toBe(404);
    expect(await exists(published)).toBe(true);
    expect(await folderFiles(`${a.id}/${published}`)).toHaveLength(1);
  });

  it('409 PROFILE_NOT_PUBLISHED for a draft, which stays', async () => {
    const res = await call('DELETE', draft, { token: a.accessToken });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PROFILE_NOT_PUBLISHED' });
    expect(await exists(draft)).toBe(true);
  });

  it('400s a non-UUID id', async () => {
    const res = await call('DELETE', 'not-a-uuid', { token: a.accessToken });
    expect(res.status).toBe(400);
  });

  it('200s the owner, removing the resume folder, then 404s the repeat', async () => {
    const res = await call('DELETE', published, { token: a.accessToken });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { id: published } });
    expect(await exists(published)).toBe(false);
    expect(await folderFiles(`${a.id}/${published}`)).toEqual([]);
    const again = await call('DELETE', published, { token: a.accessToken });
    expect(again.status).toBe(404);
    expect(
      (await call('DELETE', randomUUID(), { token: a.accessToken })).status,
    ).toBe(404);
  });
});
