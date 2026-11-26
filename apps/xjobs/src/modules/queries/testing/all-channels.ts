import type * as Enums from 'src/common/enums';

/**
 * For `vi.mock('src/common/enums', ...)` in specs that cover every channel's
 * builder, the ones outside `ACTIVE_CHANNELS` included: makes every channel
 * active, minus `except`, posts (built by `postRecipes`) and Indeed (by `indeedRecipes`),
 * which are not builders.
 */
export function withAllChannelsActive(
  enums: typeof Enums,
  except: readonly Enums.Channel[] = [],
): typeof Enums {
  return {
    ...enums,
    ACTIVE_CHANNELS: Object.values(enums.Channel).filter(
      (channel) =>
        channel !== enums.Channel.LINKEDIN_POSTS &&
        channel !== enums.Channel.INDEED &&
        !except.includes(channel),
    ),
  };
}
