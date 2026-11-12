import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from 'jose';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { UserTokenVerifier } from './user-token.verifier';

const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const SUB = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

async function keyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
}

type Overrides = {
  claims?: Record<string, unknown>;
  iss?: string;
  aud?: string;
  exp?: string | number | null;
  omitSub?: boolean;
};

async function sign(privateKey: PrivateKey, o: Overrides = {}) {
  const claims: Record<string, unknown> = {
    role: 'authenticated',
    ...(o.omitSub ? {} : { sub: SUB }),
    ...o.claims,
  };
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? 'authenticated');
  if (o.exp !== null) jwt.setExpirationTime(o.exp ?? '1h');
  return jwt.sign(privateKey);
}

function verifier(keys: JWTVerifyGetKey) {
  return new UserTokenVerifier(keys, ISSUER);
}

describe('UserTokenVerifier', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the sub of a valid token', async () => {
    const { privateKey, keys } = await keyPair();
    await expect(verifier(keys).verify(await sign(privateKey))).resolves.toBe(
      SUB,
    );
  });

  it('rejects an expired token', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, {
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an issuer that differs (localhost vs 127.0.0.1)', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, {
      iss: 'http://localhost:54321/auth/v1',
    });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an audience that differs', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, { aud: 'other' });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects the anon role', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, { claims: { role: 'anon' } });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a sub that is not a UUID', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, { claims: { sub: 'not-a-uuid' } });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token without exp (it would never expire)', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, { exp: null });
    await expect(verifier(keys).verify(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a missing sub', async () => {
    const { privateKey, keys } = await keyPair();
    const token = await sign(privateKey, { omitSub: true });
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed by another key pair (other project)', async () => {
    const { keys } = await keyPair();
    const other = await keyPair();
    const token = await sign(other.privateKey);
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an HS256 token signed with a shared secret', async () => {
    const { keys } = await keyPair();
    const token = await new SignJWT({ sub: SUB, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('s'.repeat(32)));
    await expect(verifier(keys).verify(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a garbage string', async () => {
    const { keys } = await keyPair();
    await expect(verifier(keys).verify('garbage')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('answers 503 when the key set throws a non-JOSE error', async () => {
    const { privateKey } = await keyPair();
    const keys: JWTVerifyGetKey = () => {
      throw new TypeError('fetch failed');
    };
    await expect(verifier(keys).verify(await sign(privateKey))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 503 on a JWKS timeout', async () => {
    const { privateKey } = await keyPair();
    const keys: JWTVerifyGetKey = () => {
      throw new errors.JWKSTimeout();
    };
    await expect(verifier(keys).verify(await sign(privateKey))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 503 when the key set throws the bare JOSEError (non-200 JWKS reply)', async () => {
    const { privateKey } = await keyPair();
    const keys: JWTVerifyGetKey = () => {
      throw new errors.JOSEError(
        'Expected 200 OK from the JSON Web Key Set HTTP response',
      );
    };
    await expect(verifier(keys).verify(await sign(privateKey))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  describe('against a JWKS endpoint answering 500', () => {
    let server: Server;
    let url: URL;

    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      url = new URL(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`,
      );
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('answers 503', async () => {
      const { privateKey } = await keyPair();
      await expect(
        verifier(createRemoteJWKSet(url)).verify(await sign(privateKey)),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
