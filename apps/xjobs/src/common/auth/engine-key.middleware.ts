import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { ErrorResponseDto } from '../dtos';
import { ErrorCode } from '../enums';
import type { TracedRequest } from '../types';
import { traceIdOf } from '../middleware';

/** Header carrying the key shared by the engine and the web app (Node lowercases it). */
export const ENGINE_KEY_HEADER = 'x-engine-key';

/** Compares digests so neither the length nor the content leaks through timing. */
function same(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * @description Requires the shared engine key on every request, health
 * included. A failure is a plain 401 in the error envelope with no challenge
 * header and no hint of what was wrong. It answers directly instead of
 * throwing, because Nest filters do not wrap `app.use` middleware.
 */
export function engineKeyMiddleware(
  expected: string,
): (req: TracedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const given = req.headers[ENGINE_KEY_HEADER];
    // A repeated header arrives as an array; only a single string counts.
    if (typeof given === 'string' && same(given, expected)) {
      next();
      return;
    }
    res
      .status(401)
      .json(
        ErrorResponseDto.of(
          ErrorCode.UNAUTHORIZED,
          'Authentication required',
          traceIdOf(req),
        ),
      );
  };
}
