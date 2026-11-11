import { Injectable } from '@nestjs/common';
import { DatabaseService, type UserRow } from 'src/database';
import type { Eligibility } from '../types';

/**
 * Injection token and contract for user persistence. Rows are created by the
 * sign-up trigger on auth.users, so there is no create.
 */
export abstract class UsersRepository {
  abstract findById(userId: string): Promise<UserRow | null>;
  abstract eligibility(userId: string): Promise<Eligibility | null>;
}

@Injectable()
export class PrismaUsersRepository extends UsersRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get users() {
    return this.database.db.orm.public.User;
  }

  findById(userId: string): Promise<UserRow | null> {
    return this.users.where({ id: userId }).first();
  }

  async eligibility(userId: string): Promise<Eligibility | null> {
    const user = await this.findById(userId);
    return user
      ? {
          residenceCountry: user.residenceCountry,
          acceptsSponsorship: user.acceptsSponsorship,
        }
      : null;
  }
}
