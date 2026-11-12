import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthedRequest } from '../types';
import { UserTokenVerifier } from 'src/modules/auth/services';

const BEARER = /^Bearer (\S+)$/i;

/**
 * @description Requires a verified Supabase user token in `Authorization` and
 * sets `request.userId`. Anything but exactly one `Bearer <token>` is a 401.
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly verifier: UserTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }
    request.userId = await this.verifier.verify(token);
    return true;
  }
}
