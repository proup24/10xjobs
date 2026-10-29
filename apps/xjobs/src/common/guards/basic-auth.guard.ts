import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { BasicAuthConfig } from 'src/config';
import { IS_PUBLIC } from '../decorators';

/** Injection token for the credentials the guard checks against. */
export const BASIC_AUTH_CREDENTIALS = Symbol('BASIC_AUTH_CREDENTIALS');

const CHALLENGE = 'Basic realm="10xjobs", charset="UTF-8"';

/** Compares digests so neither the length nor the content leaks through timing. */
function same(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Reads `user:pass` from an `Authorization: Basic …` header, or null. */
function credentialsOf(header: string | undefined) {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

/**
 * @description Requires HTTP Basic auth on every route except those marked
 * `@Public()`. A failure is a 401 with a Basic challenge, formatted by the
 * global exception filter.
 */
@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(BASIC_AUTH_CREDENTIALS) private readonly expected: BasicAuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const given = credentialsOf(
      http.getRequest<Request>().headers.authorization,
    );
    // Check both fields even when the first fails, so timing says nothing.
    const valid =
      given !== null &&
      [
        same(given.username, this.expected.username),
        same(given.password, this.expected.password),
      ].every(Boolean);
    if (valid) return true;

    http.getResponse<Response>().setHeader('WWW-Authenticate', CHALLENGE);
    throw new UnauthorizedException('Authentication required');
  }
}
