/** In-memory activity repository for unit tests; not part of the application build. */
import type { Channel } from 'src/common/enums';
import { ActivityRepository, type SearchesState } from '../activity.repository';

export class FakeActivityRepository extends ActivityRepository {
  /** Paused builder ids per channel; ignores `at` and `hours`. */
  pausedBuilders = new Map<Channel, Set<string>>();
  states = new Map<string, SearchesState>();
  resumed: { userId: string; at: Date }[] = [];

  async pausedBuilderIds(channel: Channel): Promise<Set<string>> {
    return new Set(this.pausedBuilders.get(channel) ?? []);
  }

  async userState(userId: string): Promise<SearchesState> {
    return this.states.get(userId) ?? { paused: false, lastActiveAt: null };
  }

  /** Records the call; the user is no longer paused and was last active at `at` at the latest. */
  async resume(userId: string, at: Date): Promise<void> {
    this.resumed.push({ userId, at });
    const state = await this.userState(userId);
    const last = state.lastActiveAt;
    this.states.set(userId, {
      paused: false,
      lastActiveAt: last && last > at ? last : at,
    });
  }
}
