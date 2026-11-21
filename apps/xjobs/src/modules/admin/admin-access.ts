import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Who may use the admin routes: the users listed in `ADMIN_USERS`. */
@Injectable()
export class AdminAccess {
  private readonly users: ReadonlySet<string>;

  constructor(config: ConfigService<{ ADMIN_USERS?: string[] }, true>) {
    this.users = new Set(config.get('ADMIN_USERS', { infer: true }) ?? []);
  }

  isAdmin(userId: string): boolean {
    return this.users.has(userId);
  }
}
