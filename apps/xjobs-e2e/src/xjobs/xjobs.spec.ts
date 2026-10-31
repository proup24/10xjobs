import axios from 'axios';

describe('GET /api/health', () => {
  it('reports every dependency up, without credentials', async () => {
    // fetch, not axios: axios instances inherit the default credentials.
    const res = await fetch(`${axios.defaults.baseURL}/api/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      data: { status: string; checks: Record<string, { status: string }> };
    };
    expect(body.data.status).toBe('ok');
    for (const name of ['database', 'queue', 'cache'])
      expect(body.data.checks[name]).toMatchObject({ status: 'up' });
  });
});

describe('basic auth', () => {
  it('401s a protected route without credentials, with a Basic challenge', async () => {
    // fetch, not axios: axios instances inherit the default credentials.
    const res = await fetch(`${axios.defaults.baseURL}/api/users`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
    expect(await res.json()).toMatchObject({
      status: 'error',
      code: 'UNAUTHORIZED',
    });
  });

  it('401s wrong credentials', async () => {
    const res = await axios.get('/api/users', {
      auth: { username: 'admin', password: 'definitely-wrong-password' },
      validateStatus: () => true,
    });
    expect(res.status).toBe(401);
  });
});
