/** How ingest unifies raw items into normalized jobs. */
export const normalizeConfig = {
  /** Apply URL query parameters that only track the click; all others are kept. */
  trackingParams: [
    /^utm_/i,
    /^trk/i,
    'gh_src',
    'refId',
    'ref',
    'src',
    'source',
  ],
  /** A non-ATS apply URL is a job id only if its path or query has one of these. */
  identifierPattern:
    /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /** A job seen again after this long unseen is reopened and goes back to Process. */
  reopenAfterMs: 21 * 24 * 60 * 60 * 1000,
} as const;
