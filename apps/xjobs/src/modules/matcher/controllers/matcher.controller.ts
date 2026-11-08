import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from 'src/common/decorators';
import { MatcherRepository } from '../repositories/matcher.repository';
import { MatcherService } from '../services/matcher.service';

/**
 * Manual entry points to the matcher, for testing and inspection. Behind the
 * app's basic auth. No model is called.
 */
@ApiTags('matcher')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('matcher')
export class MatcherController {
  constructor(
    private readonly matcher: MatcherService,
    private readonly repository: MatcherRepository,
  ) {}

  @ApiOperation({
    summary: 'Match one job now',
    description:
      'Decides the job against every published profile in this request, even where the stored rows are current, and returns the outcome with the stored rows. A job that is not matchable (not processed, closed, out of the window, or without a v2 extraction) returns `not_matchable` and no rows.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The outcome and the stored match rows of the job.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('jobs/:jobId/run')
  async run(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const outcome = await this.matcher.matchJob(jobId, { force: true });
    return { ...outcome, matches: await this.repository.matchesForJob(jobId) };
  }

  @ApiOperation({ summary: "A job's stored matches, one per profile" })
  @ApiResponse({ status: HttpStatus.OK, description: 'The match rows.' })
  @Get('jobs/:jobId')
  async matches(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return { matches: await this.repository.matchesForJob(jobId) };
  }
}
