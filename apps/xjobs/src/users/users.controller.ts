import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { UserRow } from 'src/database';
import { WorkspacesService } from 'src/workspaces';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('workspaces/:workspaceId/users')
export class UsersController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
  ) {}

  @Post()
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateUserDto,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.create(workspaceId, body);
  }

  @Get()
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<UserRow[]> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.list(workspaceId);
  }

  @Get(':userId')
  async get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.getOrThrow(workspaceId, userId);
  }

  @Patch(':userId')
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.update(workspaceId, userId, body);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.workspaces.getOrThrow(workspaceId);
    await this.users.delete(workspaceId, userId);
  }
}
