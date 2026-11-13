import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from 'src/common/decorators';
import type { ProcessorEnvironmentVariables } from 'src/config';
import {
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import { ExtractionFailed } from '../services/extraction-pipeline.service';
import {
  ProcessorBlockedError,
  ProcessorService,
} from '../services/processor.service';
import { PreviewPostingDto } from '../dtos/preview.dto';

/**
 * Manual entry points to the processor, for testing and inspection. Local
 * only, with `XJOBS_OPERATOR_ENDPOINTS=1`, and the engine key. Preview and run
 * call the paid models.
 */
@ApiTags('processor')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('processor')
export class ProcessorController {
  constructor(
    private readonly processor: ProcessorService,
    private readonly config: ConfigService<ProcessorEnvironmentVariables, true>,
  ) {}

  @ApiOperation({
    summary: 'Extract the facts of a posting, storing nothing',
    description:
      'Runs the generator and every check on the posting. Saves no extraction and no vocabulary; the model calls are recorded and count against the daily budget.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'The extraction document, its typed filter columns, needsReview, the cost and every model call.',
  })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  @HttpCode(HttpStatus.OK)
  @Post('preview')
  async preview(@Body() body: PreviewPostingDto) {
    this.requireKey();
    try {
      return await this.processor.preview({
        title: body.title,
        description: body.description,
      });
    } catch (error) {
      throw toHttp(error);
    }
  }

  @ApiOperation({
    summary: 'Process one normalized job now',
    description:
      'Sends the job back to pending and processes it in this request, through the same path as the worker. Only LinkedIn job board jobs are in scope.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The outcome and the job state after the run.',
  })
  @ApiErrorResponses(HttpStatus.NOT_FOUND, HttpStatus.SERVICE_UNAVAILABLE)
  @HttpCode(HttpStatus.OK)
  @Post('jobs/:jobId/run')
  async run(@Param('jobId', ParseUUIDPipe) jobId: string) {
    this.requireKey();
    const state = await this.processor.jobState(jobId);
    if (!state) throw new NotFoundException(`No normalized job ${jobId}`);
    if (!state.inScope)
      throw new HttpException(
        `Job ${jobId} is out of the processor's scope (an active LinkedIn job board job)`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return this.processor.processNow(jobId);
  }

  @ApiOperation({ summary: "A job's processing state and current extraction" })
  @ApiResponse({ status: HttpStatus.OK, description: 'The job state.' })
  @ApiErrorResponses(HttpStatus.NOT_FOUND)
  @Get('jobs/:jobId')
  async job(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const state = await this.processor.jobState(jobId);
    if (!state) throw new NotFoundException(`No normalized job ${jobId}`);
    return state;
  }

  @ApiOperation({
    summary: 'Processor overview',
    description:
      "In-scope jobs per processing status, today's spend against the budget, the models, and whether this process is paused.",
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The overview.' })
  @Get('status')
  status() {
    return this.processor.status();
  }

  /** Without a key every call would fail with 401 and pause processing. */
  private requireKey(): void {
    if (!this.config.get('OPENROUTER_API_KEY', { infer: true }))
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY is not set for this app',
      );
  }
}

function toHttp(error: unknown): unknown {
  if (error instanceof ProcessorBlockedError)
    return new HttpException(
      error.message,
      error.reason === 'over_budget'
        ? HttpStatus.TOO_MANY_REQUESTS
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
  if (error instanceof ProviderUnavailableError)
    return new ServiceUnavailableException(error.message);
  if (error instanceof ExtractionFailed)
    return new HttpException(
      `The generated document was invalid after every try: ${error.message}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  if (
    error instanceof TransientModelError ||
    error instanceof ModelRequestError
  )
    return new HttpException(error.message, HttpStatus.BAD_GATEWAY);
  return error;
}
