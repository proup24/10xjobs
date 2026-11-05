import type { Address } from 'src/database';

/** The fields a user can change; the row itself comes from the sign-up trigger. */
export type UserInput = {
  name?: string | null;
  address?: Address | null;
};
