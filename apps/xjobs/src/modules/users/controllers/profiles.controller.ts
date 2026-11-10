import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, UserGuard } from 'src/common/auth';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { PublishProfileResponseDto } from '../dto/publish-profile.response.dto';
import { ProfilesService } from '../services/profiles.service';
import type { PublishedProfileView } from '../types';

@ApiTags('profiles')
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
}
