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
  });

  afterAll(async () => {
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

  it('200s the owner, then 404s the repeat', async () => {
    const res = await call('DELETE', published, { token: a.accessToken });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { id: published } });
    expect(await exists(published)).toBe(false);
    const again = await call('DELETE', published, { token: a.accessToken });
    expect(again.status).toBe(404);
    expect(
      (await call('DELETE', randomUUID(), { token: a.accessToken })).status,
    ).toBe(404);
  });
});
