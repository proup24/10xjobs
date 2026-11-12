import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthedRequest } from '../types';

/** The user id `UserGuard` verified. A route that forgot `UserGuard` fails here, not as an anonymous caller. */
export function currentUserId(context: ExecutionContext): string {
  const { userId } = context.switchToHttp().getRequest<AuthedRequest>();
  if (typeof userId !== 'string')
    throw new InternalServerErrorException('Internal server error');
  return userId;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => currentUserId(context),
);
