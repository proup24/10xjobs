import { Channel } from 'src/common/enums';

/** How ingest treats one channel's payloads. */
export interface ChannelIngestConfig {
  kind: 'job' | 'post';
  /**
   * Payload fields (dotted paths) left out of the content hash: they change
   * between observations of the same content (positions, relative times,
   * counters, signed image URLs, the search that found it). Checked against
   * the real actor payloads in career-hub's fixtures.
   */
  volatileKeys: readonly string[];
}

const linkedinJobBoardIngest: ChannelIngestConfig = {
  kind: 'job',
  volatileKeys: [
    // bebity's search echo; cheap_scraper's is `searchString`.
    'scrapingInfo',
    'searchString',
    'postedTime',
    'applicationsCount',
    'companyLogo',
    // harvestapi: signed image URLs, counters and the search echo change
    // between scrapes of an unchanged posting.
    'company.logo',
    'company.logos',
    'company.backgroundCover',
    'company.backgroundCovers',
    'company.followerCount',
    'company.employeeCount',
    'applicants',
    'views',
    'new',
    '_meta',
    'query',
    'headerCaptionText',
  ],
};

export const channelIngestConfig: Record<Channel, ChannelIngestConfig> = {
  [Channel.LINKEDIN_JOB_BOARD]: linkedinJobBoardIngest,
  // The trial actor feeds the same fields as the main board.
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: linkedinJobBoardIngest,
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: linkedinJobBoardIngest,
  [Channel.LINKEDIN_POSTS]: {
    kind: 'post',
    volatileKeys: [
      'query',
      'postedAt.postedAgoShort',
      'postedAt.postedAgoText',
      'author.info',
      'author.avatar',
      'engagement',
      'document.manifest',
    ],
  },
  // The Google snippet varies with the search that found it; the posting is the content.
  [Channel.ASHBY]: { kind: 'job', volatileKeys: ['hit'] },
  [Channel.GREEN_HOUSE]: { kind: 'job', volatileKeys: ['hit'] },
  // Employer ratings and image URLs move without the job changing.
  [Channel.INDEED]: {
    kind: 'job',
    volatileKeys: [
      'employer.ratingsCount',
      'employer.ratingsValue',
      'employer.logoUrl',
      'employer.headerImageUrl',
      'employer.ceoPhotoUrl',
    ],
  },
};

/** Collected and stored, not yet ingested: none today; a new channel can wait here until its ingest lands. */
export const INGEST_WAITING_CHANNELS: readonly Channel[] = [];
