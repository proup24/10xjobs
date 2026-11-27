import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from 'src/common/enums';
import type { EnvironmentVariables } from 'src/config';
import { SearchSegmentsRepository } from '../repositories/segments.repository';
import {
  DailyBudget,
  moroccoDayStart,
  nextMoroccoDayStart,
  postsBudgetReached,
  POSTS_NULL_COST_MICRO_USD,
} from './spend';

/** The posts channel's budget for one Morocco day. */
export interface PostsBudgetDay {
  dayStart: Date;
  nextDayStart: Date;
  limitUsd: number;
  spentMicroUsd: number;
  /** No more runs start today: the limit is spent or less than the minimum is left. */
  reached: boolean;
}

/** Reads the posts channel's daily budget the way collection does. */
@Injectable()
export class PostsBudgetService {
  constructor(
    private readonly segments: SearchSegmentsRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async today(now: Date): Promise<PostsBudgetDay> {
    const dayStart = moroccoDayStart(now);
    const limitUsd = this.config.get(
      'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS',
      {
        infer: true,
      },
    );
    const spentMicroUsd = await this.segments.spentMicroUsd(
      Channel.LINKEDIN_POSTS,
      dayStart,
      POSTS_NULL_COST_MICRO_USD,
    );
    const budget = new DailyBudget(limitUsd, spentMicroUsd, dayStart);
    return {
      dayStart,
      nextDayStart: nextMoroccoDayStart(now),
      limitUsd,
      spentMicroUsd,
      reached: postsBudgetReached(budget),
    };
  }
}
