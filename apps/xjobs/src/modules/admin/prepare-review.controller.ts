import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  CurrentUser,
} from 'src/common/decorators';
import { UserGuard } from 'src/common/guards';
import { ENGINE_KEY_AND_BEARER } from 'src/swagger/security';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import {
  AUTHOR_KEY,
  AdminMeResponseDto,
  DropsPageDto,
  DropsQueryDto,
  HeldPostsPageDto,
  SilenceAuthorDto,
  SilenceAuthorResponseDto,
  SilencedAuthorViewDto,
  SilencedPostsQueryDto,
} from './dto/prepare-review.dto';
import { PrepareReviewService } from './prepare-review.service';
import type {
  DropView,
  HeldPostView,
  Page,
  SilencedAuthorView,
} from './prepare-review.types';

const DEFAULT_LIMIT = 50;

@ApiTags('admin')
@ApiSecurity(ENGINE_KEY_AND_BEARER)
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('admin')
@UseGuards(UserGuard)
export class PrepareReviewController {
  constructor(
    private readonly access: AdminAccess,
    private readonly review: PrepareReviewService,
  ) {}

  @ApiSuccessResponse(AdminMeResponseDto, {
    description: 'Whether the caller is an admin; any signed-in user may ask',
  })
  @Get('me')
  me(@CurrentUser() userId: string): { admin: boolean } {
    return { admin: this.access.isAdmin(userId) };
  }

  @ApiSuccessResponse(DropsPageDto, {
    description:
      'Posts dropped by Prepare (any invalid current version), newest first. `rule` is null for a drop that is not a `prepare:` rule.',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Get('prepare/drops')
  drops(@Query() query: DropsQueryDto): Promise<Page<DropView>> {
    return this.review.drops({
      rule: query.rule ?? null,
      before: query.before ?? null,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
  }

  @ApiSuccessResponse(HeldPostsPageDto, {
    description: 'Post jobs held because every source author is silenced',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Get('prepare/silenced-posts')
  silencedPosts(
    @Query() query: SilencedPostsQueryDto,
  ): Promise<Page<HeldPostView>> {
    return this.review.silencedPosts({
      before: query.before ?? null,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
  }

  @ApiSuccessResponse(SilencedAuthorViewDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Get('silenced-authors')
  silencedAuthors(): Promise<SilencedAuthorView[]> {
    return this.review.silencedAuthors();
  }

  @ApiSuccessResponse(SilenceAuthorResponseDto, {
    status: HttpStatus.CREATED,
    description: '201 when silenced now, 200 when it already was',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Post('silenced-authors')
  async silence(
    @CurrentUser() adminId: string,
    @Body() body: SilenceAuthorDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'silenced' | 'already' }> {
    const status = await this.review.silence(adminId, {
      authorKey: body.authorKey,
      name: body.name ?? null,
      reason: body.reason,
    });
    res.status(status === 'silenced' ? HttpStatus.CREATED : HttpStatus.OK);
    return { status };
  }

  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
  )
  @ApiSecurity(ENGINE_KEY_AND_BEARER)
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('silenced-authors/:authorKey')
  async unsilence(@Param('authorKey') authorKey: string): Promise<void> {
    if (!AUTHOR_KEY.test(authorKey))
      throw new BadRequestException('authorKey must be profile:… or company:…');
    await this.review.unsilence(authorKey);
  }
}
