import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { UserGuard } from 'src/common/guards';
import { ENGINE_KEY_AND_BEARER } from 'src/swagger/security';
import { AdminGuard } from './admin.guard';
import {
  PostsBudgetReportService,
  type PostsBudgetView,
} from './posts-budget.service';

export class PostsBudgetDayViewDto {
  @ApiProperty({ description: '00:00 Morocco time of the day' })
  dayStart!: string;
  @ApiProperty({
    description: 'Spent that day; a run with no cost counts $0.25',
  })
  spentUsd!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'When the run that reached the daily budget finished',
  })
  reachedAt!: string | null;
}

export class PostsBudgetSearchViewDto {
  @ApiProperty() key!: string;
  @ApiProperty({
    description:
      "The segment's hash: the parts of a group split past the segment size share a key",
  })
  hash!: string;
  @ApiProperty({ description: 'Distinct profiles across the members' })
  profiles!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "The oldest member's cursor; null when one was never searched",
  })
  oldestCoveredUntil!: string | null;
  @ApiProperty({ description: 'The oldest cursor is more than 24 hours old' })
  overDay!: boolean;
}

export class PostsBudgetFullRunsViewDto {
  @ApiProperty() key!: string;
  @ApiProperty() runs!: number;
  @ApiProperty() lastAt!: string;
}

export class PostsBudgetResponseDto implements PostsBudgetView {
  @ApiProperty() limitUsd!: number;
  @ApiProperty({ type: PostsBudgetDayViewDto }) today!: PostsBudgetDayViewDto;
  @ApiProperty({
    type: [PostsBudgetDayViewDto],
    description: 'The 7 Morocco days before today, newest first',
  })
  days!: PostsBudgetDayViewDto[];
  @ApiProperty({
    type: [PostsBudgetSearchViewDto],
    description:
      'Current post searches of runnable builders, most behind first',
  })
  searches!: PostsBudgetSearchViewDto[];
  @ApiProperty({
    description:
      'Active post builders left out because every owner is paused for inactivity',
  })
  pausedBuilders!: number;
  @ApiProperty({
    type: [PostsBudgetFullRunsViewDto],
    description: 'Runs of the last 7 days that came back full, per segment key',
  })
  fullRuns!: PostsBudgetFullRunsViewDto[];
}

@ApiTags('admin')
@ApiSecurity(ENGINE_KEY_AND_BEARER)
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('admin')
@UseGuards(UserGuard)
export class PostsBudgetController {
  constructor(private readonly service: PostsBudgetReportService) {}

  @ApiSuccessResponse(PostsBudgetResponseDto, {
    description:
      'LinkedIn post search spend, when the daily budget was reached, the searches most behind and full runs',
  })
  @ApiErrorResponses(HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Get('posts-budget')
  report(): Promise<PostsBudgetResponseDto> {
    return this.service.view(new Date());
  }
}
