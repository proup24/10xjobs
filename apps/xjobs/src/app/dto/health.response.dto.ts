import { ApiProperty } from '@nestjs/swagger';

export enum HealthStatus {
  /** Every dependency answered. */
  ok = 'ok',
  /** A non-critical dependency (the cache) is down; the API still works. */
  degraded = 'degraded',
  /** A critical dependency is down; the endpoint answers 503. */
  error = 'error',
}

export enum CheckStatus {
  up = 'up',
  down = 'down',
}

export class HealthCheckDto {
  @ApiProperty({ enum: CheckStatus, enumName: 'HealthCheckStatus' })
  status!: CheckStatus;

  @ApiProperty({ example: 3, description: 'Round-trip time of the probe' })
  latencyMs!: number;
}

export class HealthChecksDto {
  @ApiProperty({ type: HealthCheckDto, description: 'Postgres (critical)' })
  database!: HealthCheckDto;

  @ApiProperty({
    type: HealthCheckDto,
    description: 'Redis behind the job queue (critical)',
  })
  queue!: HealthCheckDto;

  @ApiProperty({
    type: HealthCheckDto,
    description: 'Redis cache (non-critical: an outage degrades the service)',
  })
  cache!: HealthCheckDto;
}

export class HealthResponseDto {
  @ApiProperty({ enum: [HealthStatus.ok, HealthStatus.degraded] })
  status!: HealthStatus;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
