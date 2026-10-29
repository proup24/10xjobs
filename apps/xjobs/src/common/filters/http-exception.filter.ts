import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorResponseDto } from '../dtos';
import { ErrorCode } from '../enums';
import { traceIdOf } from '../middleware';
import type { TracedRequest } from '../types';

const CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

/** Reads `message` from what Nest exceptions carry: a string or `{ message }`. */
function messageOf(exception: HttpException): string | string[] {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String);
  return exception.message;
}

/**
 * @description Formats every error as the error envelope. Unexpected errors
 * become a generic 500 so driver or stack details never reach the client;
 * they are logged with the trace id instead.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const traceId = traceIdOf(http.getRequest<TracedRequest>());
    const response = http.getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `[${traceId}] ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json(
          ErrorResponseDto.of(
            ErrorCode.INTERNAL_ERROR,
            'Internal server error',
            traceId,
          ),
        );
      return;
    }

    const status = exception.getStatus();
    const message = messageOf(exception);
    const body = Array.isArray(message)
      ? ErrorResponseDto.of(
          ErrorCode.VALIDATION_FAILED,
          'Validation failed',
          traceId,
          message,
        )
      : ErrorResponseDto.of(
          CODES[status] ??
            (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.HTTP_ERROR),
          message,
          traceId,
        );
    response.status(status).json(body);
  }
}
