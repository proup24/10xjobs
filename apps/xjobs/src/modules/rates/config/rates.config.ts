/** Free, keyless source of per-USD rates (covers MAD, EUR, USD and GBP). */
export const RATES_SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';
/** How long a refresh may take before it counts as failed. */
export const RATES_FETCH_TIMEOUT_MS = 15_000;
/** Cron for the daily refresh, in UTC. */
export const RATES_REFRESH = { pattern: '0 3 * * *', timezone: 'UTC' };
