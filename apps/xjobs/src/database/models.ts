import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { AddressInput, Models } from './contract.d';

/** Drops the contract's internal symbol keys so rows are plain, nameable data. */
type Row<M> = { [K in keyof Scalars<M> as K extends string ? K : never]: Scalars<M>[K] };

/** Rows as a default fetch returns them: every scalar, no relations. */
export type WorkspaceRow = Row<Models.public_Workspace>;
export type UserRow = Row<Models.public_User>;
export type ContactRow = Row<Models.public_Contact>;
export type ProfileRow = Row<Models.public_Profile>;
export type ProfileSkillRow = Row<Models.public_ProfileSkill>;
export type Address = AddressInput;
