import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from 'src/common/types';
import { AdminAccess } from './admin-access';

/**
 * @description Allows only users listed in `ADMIN_USERS`. Runs after
 * `UserGuard`, which sets `request.userId`; anyone else is a 403.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly access: AdminAccess) {}

  canActivate(context: ExecutionContext): boolean {
    const { userId } = context.switchToHttp().getRequest<AuthedRequest>();
    if (!userId || !this.access.isAdmin(userId)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
