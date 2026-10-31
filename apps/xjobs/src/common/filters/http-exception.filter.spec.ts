import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  type ArgumentsHost,
} from '@nestjs/common';
import { API_VERSION } from '../constants';
import { ErrorCode, ResponseStatus } from '../enums';
import { HttpExceptionFilter } from './http-exception.filter';

function hostFor(request: object) {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('formats a 404 with its message', () => {
    const { host, sent } = hostFor({ traceId: 'trace-1' });
    filter.catch(new NotFoundException('User not found'), host);
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({
      status: ResponseStatus.error,
      version: API_VERSION,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      trace_id: 'trace-1',
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
  });

  it('turns validation messages into details', () => {
    const { host, sent } = hostFor({ traceId: 't' });
    filter.catch(
      new BadRequestException([
        'email must be an email',
        'name should not be empty',
      ]),
      host,
    );
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: ['email must be an email', 'name should not be empty'],
    });
  });

  it.each([
    [new ConflictException('taken'), 409, ErrorCode.CONFLICT],
    [
      new PayloadTooLargeException('File too large'),
      413,
      ErrorCode.PAYLOAD_TOO_LARGE,
    ],
    [
      new BadRequestException('A PDF file is required'),
      400,
      ErrorCode.BAD_REQUEST,
    ],
  ])('maps %s to its code', (exception, status, code) => {
    const { host, sent } = hostFor({ traceId: 't' });
    filter.catch(exception, host);
    expect(sent.status).toBe(status);
    expect(sent.body).toMatchObject({ code });
  });

  it('hides the details of an unexpected error behind a 500', () => {
    const { host, sent } = hostFor({ traceId: 't' });
    filter.catch(new Error('password=hunter2 leaked in a driver error'), host);
    expect(sent.status).toBe(500);
    expect(sent.body).toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(JSON.stringify(sent.body)).not.toContain('hunter2');
  });
});
