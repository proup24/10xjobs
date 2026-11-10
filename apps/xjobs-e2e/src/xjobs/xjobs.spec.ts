import axios from 'axios';

const base = () => axios.defaults.baseURL;
const key = () => process.env.ENGINE_API_KEY ?? '';
// fetch, not axios: the headers sent must be exactly the ones named here.
const withKey = () => ({ headers: { 'X-Engine-Key': key() } });

describe('GET /api/health', () => {
  it('401s without the key, with no WWW-Authenticate', async () => {
    const res = await fetch(`${base()}/api/health`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  it('reports every dependency up with the key', async () => {
    const res = await fetch(`${base()}/api/health`, withKey());

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

describe('unknown and removed routes', () => {
  it('401s an unknown path without the key', async () => {
    const res = await fetch(`${base()}/api/does-not-exist`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('404s an unknown path with the key', async () => {
    const res = await fetch(`${base()}/api/does-not-exist`, withKey());
    expect(res.status).toBe(404);
  });

  it.each(['/api/users', '/api/processor/status'])(
    '404s %s with the key: CRUD is gone and the operator flag is off',
    async (path) => {
      const res = await fetch(`${base()}${path}`, withKey());
      expect(res.status).toBe(404);
    },
  );
});
