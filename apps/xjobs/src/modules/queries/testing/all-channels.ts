import type * as Enums from 'src/common/enums';

/**
 * For `vi.mock('src/common/enums', ...)` in specs that cover every channel's
 * builder, the ones outside `ACTIVE_CHANNELS` included: makes every channel
 * active, minus `except`.
 */
export function withAllChannelsActive(
  enums: typeof Enums,
  except: readonly Enums.Channel[] = [],
): typeof Enums {
  return {
    ...enums,
    ACTIVE_CHANNELS: Object.values(enums.Channel).filter(
      (channel) => !except.includes(channel),
    ),
  };
}
