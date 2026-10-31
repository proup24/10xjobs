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
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user.response.dto';
import { ProfilesService } from '../services/profiles.service';
import { ResumeService } from '../services/resume.service';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly resume: ResumeService,
  ) {}

  @ApiSuccessResponse(UserResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Post()
  async create(@Body() body: CreateUserDto): Promise<UserRow> {
    return this.users.create(body);
  }

  @ApiSuccessResponse(UserResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  async list(): Promise<UserRow[]> {
    return this.users.list();
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':userId')
  async get(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserRow> {
    return this.users.getOrThrow(userId);
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Patch(':userId')
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserRow> {
    return this.users.update(userId, body);
  }

  @ApiNoContentResponse({
    description: 'Deleted, with every profile and resume file',
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.users.getOrThrow(userId);
    // The rows cascade; the shared builder counters and resume files do not.
    await this.profiles.releaseAll(userId);
    await this.resume.removeAllFor(userId);
    await this.users.delete(userId);
  }
}
