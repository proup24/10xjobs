/** Queue the rates worker consumes. */
export const RATES_QUEUE = 'rates';
/** Refresh the exchange rates from the public source. */
export const RATES_REFRESH_JOB = 'refresh';
/** Job id of the startup refresh; a fixed id keeps restarts from stacking runs. */
export const RATES_REFRESH_ON_START_JOB_ID = 'refresh-on-start';
