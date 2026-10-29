import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { ProfileResponseDto } from '../dto/profile.response.dto';
import { UpsertProfileDto } from '../dto/upsert-profile.dto';
import { ProfilesService } from '../services/profiles.service';
import type { ProfileView } from '../types';

@ApiTags('profiles')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('workspaces/:workspaceId/users/:userId/profile')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @ApiSuccessResponse(ProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Put()
  upsert(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpsertProfileDto,
  ): Promise<ProfileView> {
    return this.profiles.upsert(workspaceId, userId, {
      ...body,
      city: body.city ?? null,
    });
  }

  @ApiSuccessResponse(ProfileResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<ProfileView> {
    return this.profiles.get(workspaceId, userId);
  }
}
