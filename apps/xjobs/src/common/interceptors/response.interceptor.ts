import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { SuccessResponseDto } from '../dtos';
import { traceIdOf } from '../middleware';
import type { TracedRequest } from '../types';

/**
 * @description Wraps every handler result in the success envelope. Files and
 * empty (204) bodies pass through untouched.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TracedRequest>();
    return next
      .handle()
      .pipe(
        map((data: unknown) =>
          data === undefined || data instanceof StreamableFile
            ? data
            : SuccessResponseDto.of(data, traceIdOf(request)),
        ),
      );
  }
}
