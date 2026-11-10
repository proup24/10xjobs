import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserGuard } from 'src/common/auth';
import type { ProfilesService } from '../services/profiles.service';
import type { PublishedProfileView } from '../types';
import { ProfilesController } from './profiles.controller';

describe('ProfilesController', () => {
  it('publishes for the user from the token, not from anything else', async () => {
    const view = { id: 'profile-1' } as unknown as PublishedProfileView;
    const publish = vi.fn().mockResolvedValue(view);
    const controller = new ProfilesController({
      publish,
    } as unknown as ProfilesService);
    await expect(controller.publish('token-user', 'profile-1')).resolves.toBe(
      view,
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith('token-user', 'profile-1');
  });

  it('requires the user token on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ProfilesController)).toContain(
      UserGuard,
    );
  });
});
