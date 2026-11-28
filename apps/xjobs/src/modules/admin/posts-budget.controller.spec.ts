import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserGuard } from 'src/common/guards';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import { PostsBudgetController } from './posts-budget.controller';
import type {
  PostsBudgetReportService,
  PostsBudgetView,
} from './posts-budget.service';

const access = (admins: string[]) =>
  ({ isAdmin: (id: string) => admins.includes(id) }) as unknown as AdminAccess;

describe('PostsBudgetController', () => {
  it('guards the route with UserGuard and AdminGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PostsBudgetController)).toEqual(
      [UserGuard],
    );
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        PostsBudgetController.prototype.report,
      ),
    ).toContain(AdminGuard);
  });

  it('403s a non-admin through the real guard', () => {
    const guard = new AdminGuard(access(['admin']));
    const context = (userId: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ userId }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context('other'))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(guard.canActivate(context('admin'))).toBe(true);
  });

  it("returns the service's view", async () => {
    const view: PostsBudgetView = {
      limitUsd: 3,
      today: {
        dayStart: '2026-11-26T23:00:00.000Z',
        spentUsd: 1.5,
        reachedAt: null,
      },
      days: [],
      searches: [
        {
          key: 'linkedin_posts|en|backend|remote',
          hash: 'abc123',
          profiles: 2,
          oldestCoveredUntil: null,
          overDay: false,
        },
      ],
      pausedBuilders: 1,
      fullRuns: [],
    };
    const report = vi.fn().mockResolvedValue(view);
    const controller = new PostsBudgetController({
      view: report,
    } as unknown as PostsBudgetReportService);
    expect(await controller.report()).toBe(view);
    expect(report).toHaveBeenCalledWith(expect.any(Date));
  });
});
