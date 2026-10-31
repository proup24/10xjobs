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
import type { ContactRow } from 'src/database';
import { ContactResponseDto } from '../dto/contact.response.dto';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import { ContactsService } from '../services/contacts.service';

@ApiTags('contacts')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('users/:userId/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @ApiSuccessResponse(ContactResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Post()
  create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: CreateContactDto,
  ): Promise<ContactRow> {
    return this.contacts.create(userId, body);
  }

  @ApiSuccessResponse(ContactResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  list(@Param('userId', ParseUUIDPipe) userId: string): Promise<ContactRow[]> {
    return this.contacts.list(userId);
  }

  @ApiSuccessResponse(ContactResponseDto)
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Patch(':contactId')
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: UpdateContactDto,
  ): Promise<ContactRow> {
    return this.contacts.update(userId, contactId, body);
  }

  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Delete(':contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<void> {
    return this.contacts.delete(userId, contactId);
  }
}
