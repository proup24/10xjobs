import { Injectable, NotFoundException } from '@nestjs/common';
import { rethrowConflict, type UserRow } from 'src/database';
import { UsersRepository } from '../repositories/users.repository';
import type { UserInput } from '../types';

const EMAIL_TAKEN = 'A user with this email already exists';

function normalize<T extends Partial<UserInput>>(data: T): T {
  return data.email === undefined
    ? data
    : { ...data, email: data.email.trim().toLowerCase() };
}

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  create(data: UserInput): Promise<UserRow> {
    return this.users
      .create(normalize(data))
      .catch((error: unknown) => rethrowConflict(error, EMAIL_TAKEN));
  }

  list(): Promise<UserRow[]> {
    return this.users.list();
  }

  async getOrThrow(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(userId: string, data: Partial<UserInput>): Promise<UserRow> {
    const user = await this.users
      .update(userId, normalize(data))
      .catch((error: unknown) => rethrowConflict(error, EMAIL_TAKEN));
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async delete(userId: string): Promise<void> {
    if (!(await this.users.delete(userId)))
      throw new NotFoundException('User not found');
  }
}
