import {
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import type { UserRow } from 'src/database';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user.response.dto';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Kept until the CRUD endpoints go, so old callers get a clear answer. */
  @ApiErrorResponses(HttpStatus.GONE)
  @Post()
  create(): never {
    throw new GoneException('Users are created through Supabase Auth');
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
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Patch(':userId')
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserRow> {
    return this.users.update(userId, body);
  }

  /** Kept until the CRUD endpoints go: deleting only the users row would leave a broken account. */
  @ApiErrorResponses(HttpStatus.GONE)
  @Delete(':userId')
  remove(): never {
    throw new GoneException(
      'Users are removed by deleting the Supabase Auth user',
    );
  }
}
