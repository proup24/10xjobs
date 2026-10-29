import { ApiProperty } from '@nestjs/swagger';
import { API_VERSION } from '../constants';
import { ResponseStatus } from '../enums';
import { ResponseDto } from './response.dto';

export class SuccessResponseDto<T> extends ResponseDto {
  @ApiProperty({ enum: [ResponseStatus.success] })
  declare status: ResponseStatus.success;

  @ApiProperty({ description: 'The endpoint payload' })
  data!: T;

  static of<T>(data: T, traceId: string): SuccessResponseDto<T> {
    return {
      status: ResponseStatus.success,
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      trace_id: traceId,
      data,
    };
  }
}
