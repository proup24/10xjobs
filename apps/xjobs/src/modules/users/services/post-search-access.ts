import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Who may turn LinkedIn post search on: the users listed in `POST_SEARCH_USERS`. */
@Injectable()
export class PostSearchAccess {
  private readonly users: ReadonlySet<string>;

  constructor(config: ConfigService<{ POST_SEARCH_USERS?: string[] }, true>) {
    this.users = new Set(
      config.get('POST_SEARCH_USERS', { infer: true }) ?? [],
    );
  }

  allows(userId: string): boolean {
    return this.users.has(userId);
  }
}
