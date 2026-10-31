import type { Address } from 'src/database';

export type UserInput = {
  name: string;
  email: string;
  address?: Address | null;
};
