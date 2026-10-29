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
import type { ContactRow } from 'src/database';
import { ContactsService } from '../services/contacts.service';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';

@ApiTags('contacts')
@Controller('workspaces/:workspaceId/users/:userId/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post()
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: CreateContactDto,
  ): Promise<ContactRow> {
    return this.contacts.create(workspaceId, userId, body);
  }

  @Get()
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<ContactRow[]> {
    return this.contacts.list(workspaceId, userId);
  }

  @Patch(':contactId')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: UpdateContactDto,
  ): Promise<ContactRow> {
    return this.contacts.update(workspaceId, userId, contactId, body);
  }

  @Delete(':contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<void> {
    return this.contacts.delete(workspaceId, userId, contactId);
  }
}
