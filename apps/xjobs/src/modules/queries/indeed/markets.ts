/** One Indeed country site, as stored in `indeed_markets`. */
export type IndeedMarket = {
  site: string;
  countryCode: string;
  mainRemote: boolean;
  remoteLocation: string;
};
