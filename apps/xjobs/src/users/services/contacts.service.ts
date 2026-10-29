import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { rethrowConflict, type ContactRow } from 'src/database';
import { ContactsRepository, type ContactInput } from '../repositories/contacts.repository';
import { isContactValue } from '../dto/validators';
import { UsersService } from './users.service';

const CONTACT_TAKEN = 'The user already has this contact';

@Injectable()
export class ContactsService {
  constructor(
    private readonly users: UsersService,
    private readonly contacts: ContactsRepository,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    data: ContactInput,
  ): Promise<ContactRow> {
    await this.users.getOrThrow(workspaceId, userId);
    const { isPrimary, ...rest } = data;
    const contact = await this.contacts
      .create(workspaceId, userId, { ...rest, isPrimary: false })
      .catch((error: unknown) => rethrowConflict(error, CONTACT_TAKEN));
    return isPrimary
      ? this.contacts.setPrimary(workspaceId, userId, contact.id, contact.kind)
      : contact;
  }

  async list(workspaceId: string, userId: string): Promise<ContactRow[]> {
    await this.users.getOrThrow(workspaceId, userId);
    return this.contacts.list(workspaceId, userId);
  }

  async update(
    workspaceId: string,
    userId: string,
    contactId: string,
    data: Partial<ContactInput>,
  ): Promise<ContactRow> {
    const existing = await this.contacts.findById(workspaceId, userId, contactId);
    if (!existing) throw new NotFoundException('Contact not found');
    const { kind: previousKind, isPrimary: wasPrimary } = existing;
    // A patch may send only one of kind/value; check the pair it leaves behind.
    const kind = data.kind ?? existing.kind;
    if (
      (data.kind !== undefined || data.value !== undefined) &&
      !isContactValue(kind, data.value ?? existing.value)
    ) {
      throw new BadRequestException(`value is not a valid ${kind} contact`);
    }
    const { isPrimary, ...rest } = data;
    const contact = await this.contacts
      .update(
        workspaceId,
        userId,
        contactId,
        isPrimary === false ? { ...rest, isPrimary } : rest,
      )
      .catch((error: unknown) => rethrowConflict(error, CONTACT_TAKEN));
    if (!contact) throw new NotFoundException('Contact not found');
    // A primary contact moved to another kind must not leave two primaries there.
    const movedPrimary =
      isPrimary === undefined && wasPrimary && contact.kind !== previousKind;
    return isPrimary || movedPrimary
      ? this.contacts.setPrimary(workspaceId, userId, contact.id, contact.kind)
      : contact;
  }

  async delete(
    workspaceId: string,
    userId: string,
    contactId: string,
  ): Promise<void> {
    const deleted = await this.contacts.delete(workspaceId, userId, contactId);
    if (!deleted) throw new NotFoundException('Contact not found');
  }
}
