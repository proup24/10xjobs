import axios from 'axios';
import { createAuthUser, deleteAuthUser } from '../support/auth-users';

const run = Date.now().toString(36);
const ok = { validateStatus: () => true };

const profile = {
  position: 'backend_engineer',
  languages: ['EN', 'FR'],
  country: 'MA',
  city: 'Rabat',
  regions: ['MENA', 'NORTH_AFRICA', 'EMEA'],
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: ['employee', 'contractor'],
  arrangements: ['remote'],
  seniority: 'senior',
  noticePeriodDays: 30,
  techStack: [
    { technology: 'nodejs', domain: 'backend', mastery: 8, importance: 9 },
    { technology: 'typescript', domain: 'backend', mastery: 8, importance: 8 },
  ],
};

/** A replacement carries every field except the position, which is fixed at creation. */
const { position: _position, ...editable } = profile;

describe('users, profiles and resume', () => {
  let userId: string;
  let otherUserId: string;
  let profileId: string;
  const base = () => '/api/users';
  const profiles = () => `${base()}/${userId}/profiles`;

  beforeAll(async () => {
    userId = await createAuthUser('E2E User');
    otherUserId = await createAuthUser('Other');
    await axios.patch(`${base()}/${userId}`, {
      name: 'E2E User',
      address: { line1: '1 Rue X', city: 'Rabat', country: 'MA' },
    });
    await axios.patch(`${base()}/${otherUserId}`, { name: 'Other' });
  });

  afterAll(async () => {
    for (const id of [userId, otherUserId].filter(Boolean)) {
      await deleteAuthUser(id);
    }
  });

  it('answers DELETE /users/:id with 410 and leaves the user in place', async () => {
    const res = await axios.delete(`${base()}/${otherUserId}`, ok);
    expect(res.status).toBe(410);
    const user = await axios.get(`${base()}/${otherUserId}`, ok);
    expect(user.status).toBe(200);
  });

  it('reads back the name and address set through the engine', async () => {
    const user = await axios.get(`${base()}/${userId}`);
    expect(user.data.data).toMatchObject({
      id: userId,
      name: 'E2E User',
      address: { line1: '1 Rue X', city: 'Rabat', country: 'MA' },
    });
    expect(user.data.data).not.toHaveProperty('email');
  });

  it('answers POST /api/users with 410: users are created through Supabase Auth', async () => {
    const res = await axios.post(base(), { name: 'Nope' }, ok);
    expect(res.status).toBe(410);
    expect(res.data).toMatchObject({
      status: 'error',
      message: 'Users are created through Supabase Auth',
      trace_id: res.headers['x-trace-id'],
    });
  });

  it('wraps success in the envelope and echoes a caller trace id', async () => {
    const res = await axios.get(`${base()}/${userId}`, {
      headers: { 'X-Request-Id': `e2e-${run}` },
    });
    expect(res.headers['x-trace-id']).toBe(`e2e-${run}`);
    expect(res.data).toMatchObject({
      status: 'success',
      version: '1.0',
      trace_id: `e2e-${run}`,
      timestamp: expect.any(String),
      data: { id: userId },
    });
  });

  it('lists validation failures in details', async () => {
    const res = await axios.patch(`${base()}/${userId}`, { name: '' }, ok);
    expect(res.status).toBe(400);
    expect(res.data).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.data.details).toEqual(
      expect.arrayContaining([expect.stringContaining('name')]),
    );
    const user = await axios.get(`${base()}/${userId}`);
    expect(user.data.data.name).toBe('E2E User');
  });

  it('adds a primary GitHub contact', async () => {
    const res = await axios.post(`${base()}/${userId}/contacts`, {
      kind: 'github',
      value: 'https://github.com/e2e',
      isPrimary: true,
    });
    expect(res.status).toBe(201);
    expect(res.data.data).toMatchObject({ kind: 'github', isPrimary: true });
  });

  it('creates, replaces and reads back a profile', async () => {
    const created = await axios.post(profiles(), profile);
    expect(created.status).toBe(201);
    profileId = created.data.data.id;
    const put = await axios.put(`${profiles()}/${profileId}`, {
      ...editable,
      noticePeriodDays: 15,
    });
    expect(put.status).toBe(200);
    expect(put.data.data.id).toBe(profileId);
    const get = await axios.get(`${profiles()}/${profileId}`);
    const { techStack, ...fields } = profile;
    expect(get.data.data).toMatchObject({
      ...fields,
      noticePeriodDays: 15,
      resume: null,
    });
    expect(get.data.data.techStack).toEqual(techStack);
  });

  it('keeps several profiles per user and deletes one', async () => {
    const second = (await axios.post(profiles(), profile)).data.data.id;
    const listed = await axios.get(profiles());
    expect(listed.data.data.map((p: { id: string }) => p.id)).toEqual([
      profileId,
      second,
    ]);
    const deleted = await axios.delete(`${profiles()}/${second}`);
    expect(deleted.status).toBe(204);
    expect((await axios.get(profiles())).data.data).toHaveLength(1);
  });

  it('refuses to change the position of an existing profile', async () => {
    const res = await axios.put(
      `${profiles()}/${profileId}`,
      { ...editable, position: 'ml_engineer' },
      ok,
    );
    expect(res.status).toBe(400);
    expect(res.data.details).toEqual([
      expect.stringContaining('position cannot be changed'),
    ]);
    const get = await axios.get(`${profiles()}/${profileId}`);
    expect(get.data.data.position).toBe('backend_engineer');
  });

  it('freezes a profile once published; it can only be deleted', async () => {
    const id = (await axios.post(profiles(), profile)).data.data.id;
    const published = await axios.post(`${profiles()}/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.data.data.state).toBe('published');

    const put = await axios.put(
      `${profiles()}/${id}`,
      { ...editable, noticePeriodDays: 90 },
      ok,
    );
    expect(put.status).toBe(409);
    const again = await axios.post(`${profiles()}/${id}/publish`, {}, ok);
    expect(again.status).toBe(409);
    const unpublish = await axios.post(`${profiles()}/${id}/unpublish`, {}, ok);
    expect(unpublish.status).toBe(404);

    expect((await axios.delete(`${profiles()}/${id}`)).status).toBe(204);
  });

  it('rejects a profile whose timezone range is inverted', async () => {
    const res = await axios.put(
      `${profiles()}/${profileId}`,
      { ...editable, timezoneMin: 300, timezoneMax: 240 },
      ok,
    );
    expect(res.status).toBe(400);
  });

  it('uploads and downloads a resume PDF', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }),
      'cv.pdf',
    );
    const upload = await axios.post(`${profiles()}/${profileId}/resume`, form);
    expect(upload.status).toBe(201);
    expect(upload.data.data.resume.filename).toBe('cv.pdf');

    const download = await axios.get(`${profiles()}/${profileId}/resume`, {
      responseType: 'arraybuffer',
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(download.data).toString()).toBe('%PDF-1.4\n%%EOF');
  });

  it('rejects a file that is not a PDF', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['hello'], { type: 'application/pdf' }),
      'cv.pdf',
    );
    const res = await axios.post(`${profiles()}/${profileId}/resume`, form, ok);
    expect(res.status).toBe(400);
  });

  it('404s a profile reached through another user', async () => {
    const res = await axios.get(
      `${base()}/${otherUserId}/profiles/${profileId}`,
      ok,
    );
    expect(res.status).toBe(404);
  });
});
