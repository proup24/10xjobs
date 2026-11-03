import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto, SuccessResponseDto } from '../dtos';

const ERROR_DESCRIPTIONS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]:
    'Invalid input (code BAD_REQUEST or VALIDATION_FAILED)',
  [HttpStatus.UNAUTHORIZED]: 'Missing or wrong Basic auth credentials',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.CONFLICT]: 'Conflicts with an existing record',
  [HttpStatus.GONE]: 'No longer available',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Upload over the size limit',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Unexpected error; quote the trace_id',
  [HttpStatus.SERVICE_UNAVAILABLE]:
    'A critical dependency is down (code SERVICE_UNAVAILABLE)',
};

/**
 * @description Documents a success response as the envelope from
 * `SuccessResponseDto`, with `data` typed as `model` (or a list of it).
 */
export function ApiSuccessResponse(
  model: Type,
  options: {
    status?: HttpStatus;
    isArray?: boolean;
    description?: string;
  } = {},
) {
  const ref = { $ref: getSchemaPath(model) };
  return applyDecorators(
    ApiExtraModels(SuccessResponseDto, model),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(SuccessResponseDto) },
          {
            properties: {
              data: options.isArray ? { type: 'array', items: ref } : ref,
            },
          },
        ],
      },
    }),
  );
}

/** Documents each status as the envelope from `ErrorResponseDto`. */
export function ApiErrorResponses(...statuses: HttpStatus[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status],
        schema: { $ref: getSchemaPath(ErrorResponseDto) },
      }),
    ),
  );
}
