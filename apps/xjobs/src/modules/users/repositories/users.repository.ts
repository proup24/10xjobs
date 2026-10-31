import { Injectable } from '@nestjs/common';
import { DatabaseService, toStoredAddress, type UserRow } from 'src/database';
import type { UserInput } from '../types';

/** Injection token and contract for user persistence. Users are global; email is unique. */
export abstract class UsersRepository {
  abstract create(data: UserInput): Promise<UserRow>;
  abstract list(): Promise<UserRow[]>;
  abstract findById(userId: string): Promise<UserRow | null>;
  abstract update(
    userId: string,
    data: Partial<UserInput>,
  ): Promise<UserRow | null>;
  abstract delete(userId: string): Promise<boolean>;
}

@Injectable()
export class PrismaUsersRepository extends UsersRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private static toStored(data: Partial<UserInput>) {
    const { address, ...rest } = data;
    return address && Object.keys(address).length
      ? { ...rest, address: toStoredAddress(address) }
      : rest;
  }

  private get users() {
    return this.database.db.orm.public.User;
  }

  create(data: UserInput): Promise<UserRow> {
    return this.users.create({
      ...PrismaUsersRepository.toStored(data),
      name: data.name,
      email: data.email,
    });
  }

  async list(): Promise<UserRow[]> {
    return await this.users.orderBy((u) => u.createdAt.asc()).all();
  }

  findById(userId: string): Promise<UserRow | null> {
    return this.users.where({ id: userId }).first();
  }

  async update(
    userId: string,
    data: Partial<UserInput>,
  ): Promise<UserRow | null> {
    if (Object.keys(data).length === 0) return this.findById(userId);
    return this.users
      .where({ id: userId })
      .update(PrismaUsersRepository.toStored(data));
  }

  async delete(userId: string): Promise<boolean> {
    const deleted = await this.users.where({ id: userId }).delete();
    return deleted !== null;
  }
}
