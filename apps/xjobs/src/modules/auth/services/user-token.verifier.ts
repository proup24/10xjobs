import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const USER_TOKEN_KEYS = Symbol('USER_TOKEN_KEYS');
export const USER_TOKEN_ISSUER = Symbol('USER_TOKEN_ISSUER');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description Verifies a Supabase access token against the project's JWKS and
 * resolves the user id. Every bad token is the same generic 401; a key set
 * that cannot be fetched is a 503, so an outage is not mistaken for a bad
 * login. The token is never logged.
 */
@Injectable()
export class UserTokenVerifier {
  private readonly logger = new Logger(UserTokenVerifier.name);

  constructor(
    @Inject(USER_TOKEN_KEYS) private readonly keys: JWTVerifyGetKey,
    @Inject(USER_TOKEN_ISSUER) private readonly issuer: string,
  ) {}

  async verify(token: string): Promise<string> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp', 'sub'],
      }));
    } catch (error) {
      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        !(error instanceof errors.JOSEError) ||
        // jose throws the bare base class for a non-200 or non-JSON JWKS reply.
        error.code === 'ERR_JOSE_GENERIC'
      ) {
        this.logger.error(
          `User token keys unavailable: ${error instanceof Error ? error.constructor.name : typeof error}`,
        );
        throw new ServiceUnavailableException('Authentication is unavailable');
      }
      throw new UnauthorizedException('Authentication required');
    }
    const { sub, role } = payload;
    if (
      role !== 'authenticated' ||
      typeof sub !== 'string' ||
      !UUID.test(sub)
    ) {
      throw new UnauthorizedException('Authentication required');
    }
    return sub;
  }
}
