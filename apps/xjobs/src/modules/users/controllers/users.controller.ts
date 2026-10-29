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
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import type { UserRow } from 'src/database';
import { WorkspacesService } from 'src/modules/workspaces';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user.response.dto';
import { ResumeService } from '../services/resume.service';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('workspaces/:workspaceId/users')
export class UsersController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
    private readonly resume: ResumeService,
  ) {}

  @ApiSuccessResponse(UserResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Post()
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateUserDto,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.create(workspaceId, body);
  }

  @ApiSuccessResponse(UserResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<UserRow[]> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.list(workspaceId);
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':userId')
  async get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.getOrThrow(workspaceId, userId);
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Patch(':userId')
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserRow> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.users.update(workspaceId, userId, body);
  }

  @ApiNoContentResponse({ description: 'Deleted, with the resume file' })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.workspaces.getOrThrow(workspaceId);
    await this.users.getOrThrow(workspaceId, userId);
    // The rows cascade; the resume file does not, so remove it first.
    await this.resume.removeFor(workspaceId, userId);
    await this.users.delete(workspaceId, userId);
  }
}
