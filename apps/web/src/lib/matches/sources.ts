export const CHANNEL_LABELS: Record<string, string> = {
  LINKEDIN_JOB_BOARD: 'LinkedIn',
  LINKEDIN_JOB_BOARD_CHEAP: 'LinkedIn',
  LINKEDIN_POSTS: 'LinkedIn posts',
  GREEN_HOUSE: 'Greenhouse',
  ASHBY: 'Ashby',
};

export const channelLabel = (channel: string): string =>
  CHANNEL_LABELS[channel] ?? channel;
