import { ConfigService } from '@nestjs/config';
import { Channel } from 'src/common/enums';
import type { EnvironmentVariables } from 'src/config';
import { FakeSearchSegmentsRepository } from '../testing/fakes';
import { PostsBudgetService } from './posts-budget';
import { nextMoroccoDayStart, POSTS_NULL_COST_MICRO_USD } from './spend';

const NOW = new Date('2026-06-14T15:00:00Z');

function setup(limitUsd: number, spentMicroUsd: number) {
  const repository = new FakeSearchSegmentsRepository();
  const spent = vi
    .spyOn(repository, 'spentMicroUsd')
    .mockResolvedValue(spentMicroUsd);
  const config = {
    get: () => limitUsd,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return { service: new PostsBudgetService(repository, config), spent };
}

describe('PostsBudgetService.today', () => {
  it('is reached when less than the minimum is left', async () => {
    const { service } = setup(3, 2_995_000);
    expect((await service.today(NOW)).reached).toBe(true);
  });

  it('is not reached with budget left', async () => {
    const { service } = setup(3, 2_000_000);
    const day = await service.today(NOW);
    expect(day.reached).toBe(false);
    expect(day.limitUsd).toBe(3);
    expect(day.spentMicroUsd).toBe(2_000_000);
  });

  it('is reached when the limit is spent', async () => {
    const { service } = setup(3, 3_000_000);
    expect((await service.today(NOW)).reached).toBe(true);
  });

  it('counts a run with no cost as the posts null cost, from the day start', async () => {
    const { service, spent } = setup(3, 0);
    const day = await service.today(NOW);
    expect(spent).toHaveBeenCalledWith(
      Channel.LINKEDIN_POSTS,
      day.dayStart,
      POSTS_NULL_COST_MICRO_USD,
    );
    expect(day.dayStart.toISOString()).toBe('2026-06-13T23:00:00.000Z');
  });

  it('ends the day at the next Morocco midnight', async () => {
    const { service } = setup(3, 0);
    expect((await service.today(NOW)).nextDayStart).toEqual(
      nextMoroccoDayStart(NOW),
    );
  });
});
