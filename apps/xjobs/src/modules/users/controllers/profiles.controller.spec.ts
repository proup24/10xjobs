import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserGuard } from 'src/common/guards';
import type { ProfilesService } from '../services/profiles.service';
import type { PublishedProfileView } from '../types';
import { SetSearchSwitchDto } from '../dto/search-switch.dto';
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

  it('lists and sets search switches for the token user', async () => {
    const list = [
      { key: 'posts', enabled: false, searches: 4, pausedUntil: null },
    ];
    const view = {
      key: 'posts',
      enabled: true,
      searches: 4,
      pausedUntil: null,
    };
    const searchSwitches = vi.fn().mockResolvedValue(list);
    const setSearchSwitch = vi.fn().mockResolvedValue(view);
    const controller = new ProfilesController({
      searchSwitches,
      setSearchSwitch,
    } as unknown as ProfilesService);
    await expect(controller.searchSwitches('token-user', 'p1')).resolves.toBe(
      list,
    );
    expect(searchSwitches).toHaveBeenCalledExactlyOnceWith('token-user', 'p1');
    await expect(
      controller.setSearchSwitch('token-user', 'p1', 'posts', {
        enabled: true,
      }),
    ).resolves.toBe(view);
    expect(setSearchSwitch).toHaveBeenCalledExactlyOnceWith(
      'token-user',
      'p1',
      'posts',
      true,
    );
  });

  it.each([{}, { enabled: 'yes' }, { enabled: 1 }, { enabled: null }])(
    'rejects a body without a boolean enabled with 400: %j',
    async (body) => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await expect(
        pipe.transform(body, { type: 'body', metatype: SetSearchSwitchDto }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('accepts a boolean enabled', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        { enabled: false },
        { type: 'body', metatype: SetSearchSwitchDto },
      ),
    ).resolves.toEqual({ enabled: false });
  });
});
