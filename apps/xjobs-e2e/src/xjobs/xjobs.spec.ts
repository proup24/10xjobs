import axios from 'axios';

describe('GET /api', () => {
  it('should return a message', async () => {
    const res = await axios.get(`/api`);

    expect(res.status).toBe(200);
    expect(res.data.data).toEqual({ message: 'Hello API' });
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
