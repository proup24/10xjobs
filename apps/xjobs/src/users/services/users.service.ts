import { Injectable, NotFoundException } from '@nestjs/common';
import { rethrowConflict, type UserRow } from 'src/database';
import { UsersRepository, type UserInput } from '../repositories/users.repository';

const EMAIL_TAKEN = 'A user with this email already exists in the workspace';

function normalize<T extends Partial<UserInput>>(data: T): T {
  return data.email === undefined
    ? data
    : { ...data, email: data.email.trim().toLowerCase() };
}

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  create(workspaceId: string, data: UserInput): Promise<UserRow> {
    return this.users
      .create(workspaceId, normalize(data))
      .catch((error: unknown) => rethrowConflict(error, EMAIL_TAKEN));
  }

  list(workspaceId: string): Promise<UserRow[]> {
    return this.users.list(workspaceId);
  }

  async getOrThrow(workspaceId: string, userId: string): Promise<UserRow> {
    const user = await this.users.findById(workspaceId, userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(
    workspaceId: string,
    userId: string,
    data: Partial<UserInput>,
  ): Promise<UserRow> {
    const user = await this.users
      .update(workspaceId, userId, normalize(data))
      .catch((error: unknown) => rethrowConflict(error, EMAIL_TAKEN));
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async delete(workspaceId: string, userId: string): Promise<void> {
    await this.getOrThrow(workspaceId, userId);
    await this.users.delete(workspaceId, userId);
  }
}
