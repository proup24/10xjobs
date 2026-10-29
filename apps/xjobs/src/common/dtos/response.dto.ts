import { ApiProperty } from '@nestjs/swagger';
import { API_VERSION } from '../constants';
import { ResponseStatus } from '../enums';

/** Fields every response envelope carries, success or error. */
export abstract class ResponseDto {
  @ApiProperty({ enum: ResponseStatus, enumName: 'ResponseStatus' })
  status!: ResponseStatus;

  @ApiProperty({ example: API_VERSION })
  version!: string;

  @ApiProperty({ example: '2026-10-29T20:00:00.000Z', format: 'date-time' })
  timestamp!: string;

  @ApiProperty({
    description:
      'Echoed in the X-Trace-Id header; quote it when reporting an issue',
  })
  trace_id!: string;
}
