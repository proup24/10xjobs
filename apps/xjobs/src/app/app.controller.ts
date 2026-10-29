import { Controller, Get, HttpStatus } from '@nestjs/common';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  Public,
} from 'src/common/decorators';
import { AppService } from './app.service';
import { HealthResponseDto } from './dto/health.response.dto';

@ApiErrorResponses(HttpStatus.INTERNAL_SERVER_ERROR)
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiSuccessResponse(HealthResponseDto)
  /** Health check: open so probes need no credentials. */
  @Public()
  @Get()
  getData() {
    return this.appService.getData();
  }
}
