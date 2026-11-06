import type { Address, UserRow } from 'src/database';

/** The fields a user can change; the row itself comes from the sign-up trigger. */
export type UserInput = {
  name?: string | null;
  address?: Address | null;
};

/** Eligibility columns the API does not expose yet. */
export type EligibilityColumns = 'residenceCountry' | 'acceptsSponsorship';

export type UserView = Omit<UserRow, EligibilityColumns>;
