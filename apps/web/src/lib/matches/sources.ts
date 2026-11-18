export const CHANNEL_LABELS: Record<string, string> = {
  LINKEDIN_JOB_BOARD: 'LinkedIn',
  LINKEDIN_JOB_BOARD_CHEAP: 'LinkedIn',
  LINKEDIN_JOB_BOARD_BEBITY: 'LinkedIn',
  LINKEDIN_POSTS: 'LinkedIn posts',
  GREEN_HOUSE: 'Greenhouse',
  ASHBY: 'Ashby',
};

export const channelLabel = (channel: string): string =>
  CHANNEL_LABELS[channel] ?? channel;

/** Which actor collected a LinkedIn job-board channel, shown beside the source. */
export const ACTOR_LABELS: Record<string, string> = {
  LINKEDIN_JOB_BOARD: 'harvestapi',
  LINKEDIN_JOB_BOARD_CHEAP: 'cheap_scraper',
};

/** harvestapi's channel: the LinkedIn job board's main actor. */
export const HARVEST_CHANNEL = 'LINKEDIN_JOB_BOARD';

/** Whether a channel is a LinkedIn job-board actor's (harvestapi or a trial). */
export const isLinkedinJobBoard = (channel: string): boolean =>
  channel in ACTOR_LABELS;

/** The filter value for a channel: both LinkedIn job-board channels are one source. */
export const sourceOf = (channel: string): string =>
  isLinkedinJobBoard(channel) ? HARVEST_CHANNEL : channel;

const badgeText = (channel: string): string =>
  ACTOR_LABELS[channel]
    ? `${channelLabel(channel)} · ${ACTOR_LABELS[channel]}`
    : channelLabel(channel);

const ACTOR_ORDER = Object.keys(ACTOR_LABELS);

/** One text per channel: LinkedIn job-board actors first (harvestapi first), then the rest by label. */
export function channelBadges(channels: string[]): string[] {
  const unique = [...new Set(channels)];
  const actors = ACTOR_ORDER.filter((c) => unique.includes(c));
  const rest = unique
    .filter((c) => !(c in ACTOR_LABELS))
    .map(channelLabel)
    .sort((a, b) => a.localeCompare(b));
  return [...new Set([...actors.map(badgeText), ...rest])];
}

/** The distinct source labels in label order, joined with " and ". */
export const sourceText = (channels: string[]): string =>
  [...new Set(channels.map(channelLabel))].join(' and ');
