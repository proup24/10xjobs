import type { SegmentSearch } from '../../types/collector';
import { SearchNotStartedError } from '../../utils/search-not-started';
import { mergedLinkedinKeyword } from './linkedin-job-board.mapper';

/** What `valig/indeed-jobs-scraper` takes for one search; no other field is sent. */
export type IndeedInput = {
  country: string;
  title: string;
  location: string;
  limit: number;
  datePosted: '1' | '3' | '7';
};

/** The smallest of Indeed's day filters (1, 3, 7) that covers the window. */
export function indeedDatePosted(since: Date, until: Date): '1' | '3' | '7' {
  const hours = (until.getTime() - since.getTime()) / 3_600_000;
  if (hours <= 24) return '1';
  if (hours <= 72) return '3';
  return '7';
}

/**
 * The actor input of one segment: the site and location of its first member
 * (all members share them), the members' words merged into one title, and the
 * day filter covering the window.
 */
export function toIndeedInput(
  segment: SegmentSearch,
  rows: number,
): IndeedInput {
  const params = segment.queries[0]?.params ?? {};
  const site = typeof params.site === 'string' ? params.site : '';
  // A blank country would start a paid run on an unknown site.
  if (site === '')
    throw new SearchNotStartedError('Indeed segment has no site');
  return {
    country: site,
    title: mergedLinkedinKeyword(segment.queries),
    location: typeof params.location === 'string' ? params.location : '',
    limit: rows,
    datePosted: indeedDatePosted(segment.since, segment.until),
  };
}
