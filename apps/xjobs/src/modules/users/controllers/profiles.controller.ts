import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  CurrentUser,
} from 'src/common/decorators';
import { UserGuard } from 'src/common/guards';
import { ENGINE_KEY_AND_BEARER } from 'src/swagger/security';
import {
  PostSearchResponseDto,
  SetPostSearchDto,
} from '../dto/post-search.dto';
import { PublishProfileResponseDto } from '../dto/publish-profile.response.dto';
import { ProfilesService } from '../services/profiles.service';
import type { PostSearchView, PublishedProfileView } from '../types';

@ApiTags('profiles')
// Both headers on every route: one requirement object, so they are ANDed and
// the global engine-key requirement is not dropped.
@ApiSecurity(ENGINE_KEY_AND_BEARER)
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('profiles')
@UseGuards(UserGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @ApiSuccessResponse(PublishProfileResponseDto, {
    description: 'One-way: a published profile is frozen',
  })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  @HttpCode(HttpStatus.OK)
  @Post(':profileId/publish')
  publish(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<PublishedProfileView> {
    return this.profiles.publish(userId, profileId);
  }

  @ApiSuccessResponse(PostSearchResponseDto, {
    description: 'The post search switch, and whether the user may turn it on',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':profileId/post-search')
  postSearch(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<PostSearchView> {
    return this.profiles.postSearchStatus(userId, profileId);
  }

  @ApiSuccessResponse(PostSearchResponseDto, {
    description:
      'Turns post search on or off; works on a published profile. Only allow-listed users (403 POST_SEARCH_NOT_ALLOWED).',
  })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
  )
  @Put(':profileId/post-search')
  setPostSearch(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() body: SetPostSearchDto,
  ): Promise<PostSearchView> {
    return this.profiles.setPostSearch(userId, profileId, body.enabled);
  }
}
