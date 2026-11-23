import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { UserGuard } from 'src/common/guards';
import { FakeActivityRepository } from './testing/fakes';
import { SearchesController } from './searches.controller';

function setup(hours = 24) {
  const activity = new FakeActivityRepository();
  const config = {
    get: (key: string) =>
      key === 'SEARCH_PAUSE_AFTER_HOURS' ? hours : undefined,
  } as unknown as ConfigService<{ SEARCH_PAUSE_AFTER_HOURS: number }, true>;
  return { activity, controller: new SearchesController(activity, config) };
}

describe('SearchesController', () => {
  it("returns the user's state", async () => {
    const { activity, controller } = setup();
    activity.states.set('u1', {
      paused: true,
      lastActiveAt: new Date('2026-11-20T10:00:00.000Z'),
    });
    await expect(controller.state('u1')).resolves.toEqual({
      paused: true,
      lastActiveAt: '2026-11-20T10:00:00.000Z',
    });
    await expect(controller.state('nobody')).resolves.toEqual({
      paused: false,
      lastActiveAt: null,
    });
  });

  it('resume returns paused false', async () => {
    const { activity, controller } = setup();
    activity.states.set('u1', { paused: true, lastActiveAt: null });
    const result = await controller.resume('u1');
    expect(result.paused).toBe(false);
    expect(result.lastActiveAt).toEqual(expect.any(String));
    expect(activity.resumed.map((r) => r.userId)).toEqual(['u1']);
  });

  it('resume is idempotent', async () => {
    const { activity, controller } = setup();
    activity.states.set('u1', { paused: true, lastActiveAt: null });
    const first = await controller.resume('u1');
    const second = await controller.resume('u1');
    expect(first.paused).toBe(false);
    expect(second.paused).toBe(false);
  });

  it('requires the user token', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SearchesController)).toContain(
      UserGuard,
    );
  });
});
