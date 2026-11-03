import { randomUUID } from 'node:crypto';
import { seedContact } from './fixtures.js';

export type OwnedTable = {
  table: string;
  ownerColumn: 'userId' | 'id';
  /** Service role creates a row owned by userId and returns its id. */
  seed(userId: string): Promise<string>;
  /** A valid insert payload for userId, or null if users can't insert. */
  insertPayload: ((userId: string) => Promise<Record<string, unknown>>) | null;
  /** A harmless update the owner is allowed to make. */
  patch: Record<string, unknown>;
  canDelete: boolean;
};

/** Every table with an owner. Adding one here puts it under the isolation suite. */
export const ownedTables: OwnedTable[] = [
  {
    table: 'users',
    ownerColumn: 'id',
    // The sign-up trigger already created the row.
    seed: async (userId) => userId,
    insertPayload: null,
    patch: { name: 'Renamed' },
    canDelete: false,
  },
  {
    table: 'contacts',
    ownerColumn: 'userId',
    seed: seedContact,
    insertPayload: async (userId) => ({
      id: randomUUID(),
      userId,
      kind: 'email',
      value: `${randomUUID()}@xjobs.test`,
    }),
    patch: { label: 'work' },
    canDelete: true,
  },
];
