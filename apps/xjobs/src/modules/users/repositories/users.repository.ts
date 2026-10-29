import { Injectable } from '@nestjs/common';
import { DatabaseService, toStoredAddress, type UserRow } from 'src/database';
import type { UserInput } from '../types';

/** Injection token and contract for user persistence, scoped by workspace. */
export abstract class UsersRepository {
  abstract create(workspaceId: string, data: UserInput): Promise<UserRow>;
  abstract list(workspaceId: string): Promise<UserRow[]>;
  abstract findById(
    workspaceId: string,
    userId: string,
  ): Promise<UserRow | null>;
  abstract update(
    workspaceId: string,
    userId: string,
    data: Partial<UserInput>,
  ): Promise<UserRow | null>;
  abstract delete(workspaceId: string, userId: string): Promise<boolean>;
}

@Injectable()
export class PrismaUsersRepository extends UsersRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private static toStored(data: Partial<UserInput>) {
    const { address, ...rest } = data;
    return address === undefined
      ? rest
      : {
          ...rest,
          address: address === null ? null : toStoredAddress(address),
        };
  }

  private get users() {
    return this.database.db.orm.public.User;
  }

  create(workspaceId: string, data: UserInput): Promise<UserRow> {
    return this.users.create({
      ...PrismaUsersRepository.toStored(data),
      name: data.name,
      email: data.email,
      workspaceId,
    });
  }

  async list(workspaceId: string): Promise<UserRow[]> {
    return await this.users
      .where({ workspaceId })
      .orderBy((u) => u.createdAt.asc())
      .all();
  }

  findById(workspaceId: string, userId: string): Promise<UserRow | null> {
    return this.users.where({ workspaceId, id: userId }).first();
  }

  async update(
    workspaceId: string,
    userId: string,
    data: Partial<UserInput>,
  ): Promise<UserRow | null> {
    if (Object.keys(data).length === 0)
      return this.findById(workspaceId, userId);
    return this.users
      .where({ workspaceId, id: userId })
      .update(PrismaUsersRepository.toStored(data));
  }

  async delete(workspaceId: string, userId: string): Promise<boolean> {
    const deleted = await this.users
      .where({ workspaceId, id: userId })
      .delete();
    return deleted !== null;
  }
}
