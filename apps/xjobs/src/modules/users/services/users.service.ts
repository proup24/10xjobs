import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserRow } from 'src/database';
import { UsersRepository } from '../repositories/users.repository';
import type { UserInput } from '../types';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  list(): Promise<UserRow[]> {
    return this.users.list();
  }

  async getOrThrow(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(userId: string, data: UserInput): Promise<UserRow> {
    const user = await this.users.update(userId, data);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async delete(userId: string): Promise<void> {
    if (!(await this.users.delete(userId)))
      throw new NotFoundException('User not found');
  }
}
