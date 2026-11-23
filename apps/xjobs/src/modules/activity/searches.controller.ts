import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  CurrentUser,
} from 'src/common/decorators';
import { UserGuard } from 'src/common/guards';
import { ENGINE_KEY_AND_BEARER } from 'src/swagger/security';
import { ActivityRepository, type SearchesState } from './activity.repository';
import { SearchesStateResponseDto } from './dto/searches-state.response.dto';

type SearchesView = { paused: boolean; lastActiveAt: string | null };

function view(state: SearchesState): SearchesView {
  return {
    paused: state.paused,
    lastActiveAt: state.lastActiveAt?.toISOString() ?? null,
  };
}

@ApiTags('searches')
// Both headers on every route: one requirement object, so they are ANDed and
// the global engine-key requirement is not dropped.
@ApiSecurity(ENGINE_KEY_AND_BEARER)
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('me/searches')
@UseGuards(UserGuard)
export class SearchesController {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly config: ConfigService<
      { SEARCH_PAUSE_AFTER_HOURS: number },
      true
    >,
  ) {}

  @ApiSuccessResponse(SearchesStateResponseDto, {
    description:
      "Whether the user's searches are paused, and their last activity",
  })
  @Get()
  async state(@CurrentUser() userId: string): Promise<SearchesView> {
    return view(
      await this.activity.userState(userId, new Date(), this.hours()),
    );
  }

  @ApiSuccessResponse(SearchesStateResponseDto, {
    description:
      "Resumes the user's searches; a user who is not paused is left as is. Returns the state after the resume",
  })
  @HttpCode(HttpStatus.OK)
  @Post('resume')
  async resume(@CurrentUser() userId: string): Promise<SearchesView> {
    const now = new Date();
    await this.activity.resume(userId, now);
    return view(await this.activity.userState(userId, now, this.hours()));
  }

  private hours(): number {
    return this.config.get('SEARCH_PAUSE_AFTER_HOURS', { infer: true });
  }
}
