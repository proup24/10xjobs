/** LinkedIn `experienceLevel` to the `seniority` codes it allows (spec section 4). */
export const EXPERIENCE_LEVEL_SENIORITY: Record<string, string[]> = {
  Internship: ['junior'],
  'Entry level': ['junior'],
  Associate: ['junior', 'mid'],
  'Mid-Senior level': ['mid', 'senior', 'staff', 'lead', 'principal'],
  Director: ['lead', 'principal'],
  Executive: ['lead', 'principal'],
};

/** LinkedIn `contractType` to the `contract_types` codes it allows (spec section 4). */
export const LINKEDIN_CONTRACT_TYPES: Record<string, string[]> = {
  'Full-time': ['full_time'],
  'Part-time': ['part_time'],
  Contract: ['contract', 'freelance'],
  Temporary: ['temporary', 'contract'],
  Internship: ['internship'],
  Volunteer: ['volunteer'],
};
