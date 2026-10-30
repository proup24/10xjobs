import { Injectable } from '@nestjs/common';
import { DatabaseService, type ContactRow } from 'src/database';
import type { ContactInput } from '../types';

/** Injection token and contract for contact persistence, scoped by workspace and user. */
export abstract class ContactsRepository {
  abstract create(
    workspaceId: string,
    userId: string,
    data: ContactInput,
  ): Promise<ContactRow>;
  abstract list(workspaceId: string, userId: string): Promise<ContactRow[]>;
  abstract findById(
    workspaceId: string,
    userId: string,
    contactId: string,
  ): Promise<ContactRow | null>;
  abstract update(
    workspaceId: string,
    userId: string,
    contactId: string,
    data: Partial<ContactInput>,
  ): Promise<ContactRow | null>;
  abstract delete(
    workspaceId: string,
    userId: string,
    contactId: string,
  ): Promise<boolean>;
  /** Makes `contactId` the user's only primary contact of `kind`. */
  abstract setPrimary(
    workspaceId: string,
    userId: string,
    contactId: string,
    kind: ContactRow['kind'],
  ): Promise<ContactRow>;
}

@Injectable()
export class PrismaContactsRepository extends ContactsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get contacts() {
    return this.database.db.orm.public.Contact;
  }

  create(
    workspaceId: string,
    userId: string,
    data: ContactInput,
  ): Promise<ContactRow> {
    return this.contacts.create({ ...data, userId });
  }

  async list(workspaceId: string, userId: string): Promise<ContactRow[]> {
    return await this.contacts
      .where({ userId })
      .orderBy((c) => c.createdAt.asc())
      .all();
  }

  findById(
    workspaceId: string,
    userId: string,
    contactId: string,
  ): Promise<ContactRow | null> {
    return this.contacts.where({ userId, id: contactId }).first();
  }

  async update(
    workspaceId: string,
    userId: string,
    contactId: string,
    data: Partial<ContactInput>,
  ): Promise<ContactRow | null> {
    if (Object.keys(data).length === 0) {
      return this.findById(workspaceId, userId, contactId);
    }
    return this.contacts
      .where({ userId, id: contactId })
      .update(data);
  }

  async delete(
    workspaceId: string,
    userId: string,
    contactId: string,
  ): Promise<boolean> {
    const deleted = await this.contacts
      .where({ userId, id: contactId })
      .delete();
    return deleted !== null;
  }

  setPrimary(
    workspaceId: string,
    userId: string,
    contactId: string,
    kind: ContactRow['kind'],
  ): Promise<ContactRow> {
    return this.database.db.transaction(async (tx) => {
      await tx.orm.public.Contact.where({
        userId,
        kind,
      }).updateAll({ isPrimary: false });
      const contact = await tx.orm.public.Contact.where({
        userId,
        id: contactId,
      }).update({ isPrimary: true });
      if (!contact) throw new Error(`Contact ${contactId} vanished mid-update`);
      return contact;
    });
  }
}
