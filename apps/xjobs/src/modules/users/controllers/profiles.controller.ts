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
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { ProfileResponseDto } from '../dto/profile.response.dto';
import { PublishProfileResponseDto } from '../dto/publish-profile.response.dto';
import { CreateProfileDto, ReplaceProfileDto } from '../dto/profile.dto';
import { ProfilesService } from '../services/profiles.service';
import { ResumeService } from '../services/resume.service';
import type { ProfileView, PublishedProfileView } from '../types';

@ApiTags('profiles')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('users/:userId/profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly resume: ResumeService,
  ) {}

  @ApiSuccessResponse(ProfileResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Post()
  create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: CreateProfileDto,
  ): Promise<ProfileView> {
    return this.profiles.create(userId, body);
  }

  @ApiSuccessResponse(ProfileResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  list(@Param('userId', ParseUUIDPipe) userId: string): Promise<ProfileView[]> {
    return this.profiles.list(userId);
  }

  @ApiSuccessResponse(ProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':profileId')
  get(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<ProfileView> {
    return this.profiles.get(userId, profileId);
  }

  @ApiSuccessResponse(ProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Put(':profileId')
  replace(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() body: ReplaceProfileDto,
  ): Promise<ProfileView> {
    return this.profiles.replace(userId, profileId, body);
  }

  @ApiNoContentResponse({ description: 'Deleted, with its resume file' })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Delete(':profileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<void> {
    return this.resume.deleteProfile(userId, profileId);
  }

  @ApiSuccessResponse(PublishProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @HttpCode(HttpStatus.OK)
  @Post(':profileId/publish')
  publish(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<PublishedProfileView> {
    return this.profiles.publish(userId, profileId);
  }

  @ApiSuccessResponse(ProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @HttpCode(HttpStatus.OK)
  @Post(':profileId/unpublish')
  unpublish(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<ProfileView> {
    return this.profiles.unpublish(userId, profileId);
  }
}
