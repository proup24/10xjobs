import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UpsertProfileDto } from '../dto/upsert-profile.dto';
import { ProfilesService, type ProfileView } from '../services/profiles.service';

@ApiTags('profiles')
@Controller('workspaces/:workspaceId/users/:userId/profile')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

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

  @Get()
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<ProfileView> {
    return this.profiles.get(workspaceId, userId);
  }
}
