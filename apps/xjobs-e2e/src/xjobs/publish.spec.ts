import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { generateKeyPair, SignJWT } from 'jose';
import {
  createAuthUser,
  deleteAuthUser,
  setEligibility,
} from '../support/auth-users';
import { createDraftProfile, profileState } from '../support/profiles';

const publish = (
  profileId: string,
  opts: { key?: boolean; token?: string } = {},
) => {
  const headers: Record<string, string> = {};
  if (opts.key !== false)
    headers['X-Engine-Key'] = process.env.ENGINE_API_KEY ?? '';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // fetch, not axios: the headers sent must be exactly the ones named here.
  return fetch(`${axios.defaults.baseURL}/api/profiles/${profileId}/publish`, {
    method: 'POST',
    headers,
  });
};

type Body = { code?: string; message?: string; data?: unknown };
const json = async (res: Response) => (await res.json()) as Body;

describe('POST /api/profiles/:profileId/publish', () => {
  let a: { id: string; accessToken: string };
  let b: { id: string; accessToken: string };
  let profileA: string;
  let profileB: string;

  beforeAll(async () => {
    a = await createAuthUser('publish-a');
    b = await createAuthUser('publish-b');
    await setEligibility(a.id);
    profileA = await createDraftProfile(a.id);
    profileB = await createDraftProfile(b.id);
  });

  afterAll(async () => {
    for (const id of [a?.id, b?.id].filter(Boolean)) await deleteAuthUser(id);
  });

  it('401s without the key', async () => {
    const res = await publish(profileA, { key: false, token: a.accessToken });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('401s with the key but no token', async () => {
    const res = await publish(profileA);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('401s a token forged by another ES256 key', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(a.id)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const res = await publish(profileA, { token: forged });
    expect(res.status).toBe(401);
    expect(await profileState(profileA)).toBe('draft');
  });

  it("404s B's token on A's profile, same as a missing one, and A's stays a draft", async () => {
    const res = await publish(profileA, { token: b.accessToken });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe('NOT_FOUND');
    const missing = await publish(randomUUID(), { token: b.accessToken });
    expect(missing.status).toBe(404);
    expect((await json(missing)).message).toBe(body.message);
    expect(await profileState(profileA)).toBe('draft');
  });

  it("200s A's token; the profile is published", async () => {
    const res = await publish(profileA, { token: a.accessToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toMatchObject({ id: profileA, state: 'published' });
    expect(await profileState(profileA)).toBe('published');
  });

  it('409 PROFILE_PUBLISHED on a second publish', async () => {
    const res = await publish(profileA, { token: a.accessToken });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PROFILE_PUBLISHED' });
  });

  it("409 ELIGIBILITY_REQUIRED for B's own draft before B's eligibility is set", async () => {
    const res = await publish(profileB, { token: b.accessToken });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ELIGIBILITY_REQUIRED' });
    expect(await profileState(profileB)).toBe('draft');
  });

  it('400s a non-UUID profile id with a valid key and token', async () => {
    const res = await publish('not-a-uuid', { token: a.accessToken });
    expect(res.status).toBe(400);
  });
});
