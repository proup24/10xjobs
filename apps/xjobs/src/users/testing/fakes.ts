/** In-memory repositories for unit tests; not part of the application build. */
import type { ContactKind } from 'src/common/enums';
import {
  toStoredAddress,
  type ContactRow,
  type UserRow,
} from 'src/database';
import { ContactsRepository, type ContactInput } from '../contacts.repository';
import { UsersRepository, type UserInput } from '../users.repository';

export class FakeUsersRepository extends UsersRepository {
  rows: UserRow[] = [];

  async create(workspaceId: string, data: UserInput): Promise<UserRow> {
    if (
      this.rows.some(
        (row) => row.workspaceId === workspaceId && row.email === data.email,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: UserRow = {
      id: `user-${this.rows.length + 1}`,
      workspaceId,
      name: data.name,
      email: data.email,
      address: data.address ? toStoredAddress(data.address) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(workspaceId: string): Promise<UserRow[]> {
    return this.rows.filter((row) => row.workspaceId === workspaceId);
  }

  async findById(workspaceId: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.workspaceId === workspaceId && row.id === userId,
      ) ?? null
    );
  }

  async update(workspaceId: string, userId: string, data: Partial<UserInput>) {
    const row = await this.findById(workspaceId, userId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(workspaceId: string, userId: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === workspaceId && row.id === userId),
    );
    return this.rows.length < before;
  }
}

export class FakeContactsRepository extends ContactsRepository {
  rows: ContactRow[] = [];

  async create(
    workspaceId: string,
    userId: string,
    data: ContactInput,
  ): Promise<ContactRow> {
    if (
      this.rows.some(
        (row) =>
          row.userId === userId &&
          row.kind === data.kind &&
          row.value === data.value,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: ContactRow = {
      id: `contact-${this.rows.length + 1}`,
      workspaceId,
      userId,
      kind: data.kind,
      value: data.value,
      label: data.label ?? null,
      isPrimary: data.isPrimary ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(workspaceId: string, userId: string): Promise<ContactRow[]> {
    return this.rows.filter(
      (row) => row.workspaceId === workspaceId && row.userId === userId,
    );
  }

  async findById(workspaceId: string, userId: string, contactId: string) {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === workspaceId &&
          row.userId === userId &&
          row.id === contactId,
      ) ?? null
    );
  }

  async update(
    workspaceId: string,
    userId: string,
    contactId: string,
    data: Partial<ContactInput>,
  ) {
    const row = await this.findById(workspaceId, userId, contactId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(workspaceId: string, userId: string, contactId: string) {
    const row = await this.findById(workspaceId, userId, contactId);
    this.rows = this.rows.filter((candidate) => candidate !== row);
    return row !== null;
  }

  async setPrimary(
    workspaceId: string,
    userId: string,
    contactId: string,
    kind: ContactKind,
  ): Promise<ContactRow> {
    for (const row of await this.list(workspaceId, userId)) {
      if (row.kind === kind) row.isPrimary = row.id === contactId;
    }
    const row = await this.findById(workspaceId, userId, contactId);
    if (!row) throw new Error('missing contact');
    return row;
  }
}
