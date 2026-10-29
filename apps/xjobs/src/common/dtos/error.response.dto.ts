import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { API_VERSION } from '../constants';
import { ErrorCode, ResponseStatus } from '../enums';
import { ResponseDto } from './response.dto';

export class ErrorResponseDto extends ResponseDto {
  @ApiProperty({ enum: [ResponseStatus.error] })
  declare status: ResponseStatus.error;

  @ApiProperty({ enum: ErrorCode, enumName: 'ErrorCode' })
  code!: ErrorCode;

  @ApiProperty({ example: 'User not found' })
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'One entry per validation failure',
  })
  details?: string[];

  static of(
    code: ErrorCode,
    message: string,
    traceId: string,
    details?: string[],
  ): ErrorResponseDto {
    return {
      status: ResponseStatus.error,
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      trace_id: traceId,
      code,
      message,
      ...(details ? { details } : {}),
    };
  }
}
