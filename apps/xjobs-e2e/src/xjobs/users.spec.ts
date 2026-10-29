import axios from 'axios';

const run = Date.now().toString(36);
const ok = { validateStatus: () => true };

const profile = {
  positions: ['backend_engineer'],
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
    { technology: 'nodejs', domain: 'backend', mastery: 8, preference: 9 },
    { technology: 'typescript', domain: 'backend', mastery: 8, preference: 8 },
  ],
};

describe('workspaces, users, profile and resume', () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let userId: string;
  const base = () => `/api/workspaces/${workspaceId}/users`;

  beforeAll(async () => {
    workspaceId = (
      await axios.post('/api/workspaces', { name: 'E2E', slug: `e2e-${run}` })
    ).data.data.id;
    otherWorkspaceId = (
      await axios.post('/api/workspaces', {
        name: 'Other',
        slug: `e2e-other-${run}`,
      })
    ).data.data.id;
    userId = (
      await axios.post(base(), {
        name: 'E2E User',
        email: `E2E-${run}@Example.com`,
        address: { line1: '1 Rue X', city: 'Rabat', country: 'MA' },
      })
    ).data.data.id;
  });

  afterAll(async () => {
    await axios.delete(`${base()}/${userId}`, ok);
  });

  it('stores the email lowercased and 409s a duplicate', async () => {
    const user = await axios.get(`${base()}/${userId}`);
    expect(user.data.data.email).toBe(`e2e-${run}@example.com`);
    const duplicate = await axios.post(
      base(),
      { name: 'Again', email: `e2e-${run}@example.com` },
      ok,
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.data).toMatchObject({
      status: 'error',
      version: '1.0',
      code: 'CONFLICT',
      trace_id: duplicate.headers['x-trace-id'],
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
    const res = await axios.post(base(), { name: '', email: 'nope' }, ok);
    expect(res.status).toBe(400);
    expect(res.data).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.data.details).toEqual(
      expect.arrayContaining([expect.stringContaining('email')]),
    );
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

  it('saves and reads back the profile', async () => {
    const put = await axios.put(`${base()}/${userId}/profile`, profile);
    expect(put.status).toBe(200);
    const get = await axios.get(`${base()}/${userId}/profile`);
    const { techStack, ...fields } = profile;
    expect(get.data.data).toMatchObject({ ...fields, resume: null });
    expect(get.data.data.techStack).toEqual(techStack);
  });

  it('rejects a profile whose timezone range is inverted', async () => {
    const res = await axios.put(
      `${base()}/${userId}/profile`,
      { ...profile, timezoneMin: 300, timezoneMax: 240 },
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
    const upload = await axios.post(`${base()}/${userId}/profile/resume`, form);
    expect(upload.status).toBe(201);
    expect(upload.data.data.resume.filename).toBe('cv.pdf');

    const download = await axios.get(`${base()}/${userId}/profile/resume`, {
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
    const res = await axios.post(
      `${base()}/${userId}/profile/resume`,
      form,
      ok,
    );
    expect(res.status).toBe(400);
  });

  it('404s the user through another workspace', async () => {
    const res = await axios.get(
      `/api/workspaces/${otherWorkspaceId}/users/${userId}`,
      ok,
    );
    expect(res.status).toBe(404);
  });
});
