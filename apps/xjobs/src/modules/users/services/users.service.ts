import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserRow } from 'src/database';
import { UsersRepository } from '../repositories/users.repository';
import type { Eligibility } from '../types';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async getOrThrow(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** 404s an unknown user. */
  async eligibility(userId: string): Promise<Eligibility> {
    const eligibility = await this.users.eligibility(userId);
    if (!eligibility) throw new NotFoundException('User not found');
    return eligibility;
  }
}
