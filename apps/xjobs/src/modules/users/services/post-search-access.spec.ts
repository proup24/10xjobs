import type { ConfigService } from '@nestjs/config';
import { postSearchEnvironmentSchema } from 'src/config/environment.validation';
import { PostSearchAccess } from './post-search-access';

const accessFor = (env: Record<string, string>) =>
  new PostSearchAccess({
    get: (key: string) => postSearchEnvironmentSchema.parse(env)[key as never],
  } as unknown as ConfigService<{ POST_SEARCH_USERS?: string[] }, true>);

describe('PostSearchAccess', () => {
  it('allows only listed users', () => {
    const access = accessFor({ POST_SEARCH_USERS: ' user-a , user-b' });
    expect(access.allows('user-a')).toBe(true);
    expect(access.allows('user-b')).toBe(true);
    expect(access.allows('user-c')).toBe(false);
  });

  it('allows nobody by default', () => {
    expect(accessFor({}).allows('user-a')).toBe(false);
    expect(accessFor({ POST_SEARCH_USERS: '' }).allows('')).toBe(false);
  });
});
