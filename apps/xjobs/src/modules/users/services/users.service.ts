import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserRow } from 'src/database';
import { UsersRepository } from '../repositories/users.repository';
import type { UserInput, UserView } from '../types';

/** The API shape of a user: the eligibility columns stay out until the API exposes them. */
export function toUserView(user: UserRow): UserView {
  const { residenceCountry, acceptsSponsorship, ...view } = user;
  return view;
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

  async update(userId: string, data: UserInput): Promise<UserRow> {
    const user = await this.users.update(userId, data);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
