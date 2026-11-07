import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { checkViolationMessage, type UserRow } from 'src/database';
import { UsersRepository } from '../repositories/users.repository';
import type { Eligibility, UserInput, UserView } from '../types';

/** The API shape of a user: every column, eligibility included. */
export function toUserView(user: UserRow): UserView {
  return { ...user };
}

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

  /** 404s an unknown user. */
  async eligibility(userId: string): Promise<Eligibility> {
    const eligibility = await this.users.eligibility(userId);
    if (!eligibility) throw new NotFoundException('User not found');
    return eligibility;
  }

  async update(userId: string, data: UserInput): Promise<UserRow> {
    let user: UserRow | null;
    try {
      user = await this.users.update(userId, data);
    } catch (error) {
      // A code the database refuses (such as an unknown country) is the caller's mistake.
      const message = checkViolationMessage(error);
      if (message !== null) throw new BadRequestException(message);
      throw error;
    }
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
