/** LinkedIn's region codes mapped to our region codes. */
export const LINKEDIN_REGION_CODES: Record<string, string> = {
  EU: 'EU',
  EMEA: 'EMEA',
  NAMER: 'NORTH_AMERICA',
};

/** Sentinel in LINKEDIN_REGION_GEO_IDS that means a worldwide place. */
export const WORLDWIDE = 'WORLDWIDE';

/** LinkedIn's region geoIds mapped to our region codes. */
export const LINKEDIN_REGION_GEO_IDS: Record<string, string> = {
  '91000000': 'EU',
  '91000002': 'EEA',
  '91000007': 'EMEA',
  '91000001': 'MIDDLE_EAST',
  '91000008': 'MENA',
  '91000011': 'LATAM',
  '100506914': 'EUROPE',
  '103537801': 'AFRICA',
  '92000000': WORLDWIDE,
};
