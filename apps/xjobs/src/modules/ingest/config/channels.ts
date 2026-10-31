import { Channel } from 'src/common/enums';

/** How ingest treats one channel's payloads. */
export interface ChannelIngestConfig {
  kind: 'job' | 'post';
  /**
   * Top-level payload keys left out of the content hash: they change between
   * observations of the same content (positions, relative times, counters).
   */
  volatileKeys: readonly string[];
}

export const channelIngestConfig: Record<Channel, ChannelIngestConfig> = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    kind: 'job',
    volatileKeys: ['scrapingInfo', 'postedTime', 'applicantsCount'],
  },
  [Channel.LINKEDIN_POSTS]: {
    kind: 'post',
    volatileKeys: ['engagement', 'postedAt', 'query'],
  },
  // The Google snippet varies with the search that found it; the posting is the content.
  [Channel.ASHBY]: { kind: 'job', volatileKeys: ['hit'] },
  [Channel.GREEN_HOUSE]: { kind: 'job', volatileKeys: ['hit'] },
};
