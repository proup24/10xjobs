import {
  Controller,
  Get,
  Header,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { HealthResponseDto, HealthStatus } from '../dto/health.response.dto';
import { HealthService } from '../services/health.service';

@ApiErrorResponses(
  HttpStatus.INTERNAL_SERVER_ERROR,
  HttpStatus.SERVICE_UNAVAILABLE,
)
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Readiness probe: 200 when Postgres and the queue Redis answer (status
   * `degraded` if only the cache is down), 503 otherwise. Like every route it
   * needs the engine key.
   */
  @ApiSuccessResponse(HealthResponseDto)
  @Header('Cache-Control', 'no-store')
  @Get()
  async check(): Promise<HealthResponseDto> {
    const result = await this.health.check();
    if (result.status === HealthStatus.error) {
      const down = Object.entries(result.checks)
        .filter(([, check]) => check.status === 'down')
        .map(([name]) => name);
      throw new ServiceUnavailableException(
        `Unhealthy: ${down.join(', ')} down`,
      );
    }
    return result;
  }
}
