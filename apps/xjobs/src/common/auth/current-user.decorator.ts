import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../types';

/** The user id `UserGuard` verified; only valid on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<AuthedRequest>().userId as string,
);
