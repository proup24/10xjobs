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
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user.response.dto';
import { toUserView, UsersService } from '../services/users.service';
import type { UserView } from '../types';

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
  async list(): Promise<UserView[]> {
    return (await this.users.list()).map(toUserView);
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':userId')
  async get(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserView> {
    return toUserView(await this.users.getOrThrow(userId));
  }

  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Patch(':userId')
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserView> {
    return toUserView(await this.users.update(userId, body));
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
