import {
  Body,
  Controller,
  Delete,
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
  SearchSwitchResponseDto,
  SetSearchSwitchDto,
} from '../dto/search-switch.dto';
import { DeleteProfileResponseDto } from '../dto/delete-profile.response.dto';
import { PublishProfileResponseDto } from '../dto/publish-profile.response.dto';
import { ProfilesService } from '../services/profiles.service';
import type { PublishedProfileView, SearchSwitchView } from '../types';

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

  @ApiSuccessResponse(DeleteProfileResponseDto, {
    description:
      'Deletes a published profile and releases its searches; a draft is 409 PROFILE_NOT_PUBLISHED',
  })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  @HttpCode(HttpStatus.OK)
  @Delete(':profileId')
  delete(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<{ id: string }> {
    return this.profiles.deletePublished(userId, profileId);
  }

  @ApiSuccessResponse(SearchSwitchResponseDto, {
    isArray: true,
    description:
      "The profile's search switches that are available, in registry order",
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':profileId/searches')
  searchSwitches(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<SearchSwitchView[]> {
    return this.profiles.searchSwitches(userId, profileId);
  }

  @ApiSuccessResponse(SearchSwitchResponseDto, {
    description:
      'Turns a search switch on or off for any user; works on a published profile, attaching or detaching its searches. An unknown or unavailable key is a 404.',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Put(':profileId/searches/:key')
  setSearchSwitch(
    @CurrentUser() userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('key') key: string,
    @Body() body: SetSearchSwitchDto,
  ): Promise<SearchSwitchView> {
    return this.profiles.setSearchSwitch(userId, profileId, key, body.enabled);
  }
}
