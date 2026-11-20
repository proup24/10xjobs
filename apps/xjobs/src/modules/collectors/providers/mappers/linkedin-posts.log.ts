/**
 * The post actor reports SUCCEEDED even when it failed, and says so only in
 * its log. Returns why the run's results may be missing posts, or null when
 * the log shows no known failure. An unreadable log counts as failed.
 */
export function postRunFailure(log: string | null): string | null {
  if (log === null) return 'run log unavailable';
  if (log.includes('No available resource')) return 'no available resource';
  if (log.includes('Too many boolean operators'))
    return 'too many boolean operators';
  return null;
}
