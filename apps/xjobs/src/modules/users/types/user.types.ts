import type { Address, UserRow } from 'src/database';

/** The fields a user can change; the row itself comes from the sign-up trigger. */
export type UserInput = {
  name?: string | null;
  address?: Address | null;
  residenceCountry?: string | null;
  acceptsSponsorship?: boolean | null;
};

/** What a user must answer before publishing: null until answered. */
export type Eligibility = {
  residenceCountry: string | null;
  acceptsSponsorship: boolean | null;
};

export type UserView = UserRow;
