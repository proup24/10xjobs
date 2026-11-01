import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { AddressInput, Models } from './contract.d';

/** Drops the contract's internal symbol keys so rows are plain, nameable data. */
type Row<M> = {
  [K in keyof Scalars<M> as K extends string ? K : never]: Scalars<M>[K];
};

/** Rows as a default fetch returns them: every scalar, no relations. */
export type UserRow = Row<Models.public_User>;
export type ContactRow = Row<Models.public_Contact>;
export type ProfileRow = Row<Models.public_Profile>;
export type ProfileSkillRow = Row<Models.public_ProfileSkill>;
export type QuerySearchBuilderRow = Row<Models.public_QuerySearchBuilder>;
export type ProfileQuerySearchBuilderRow =
  Row<Models.public_ProfileQuerySearchBuilder>;
export type RawJobRow = Row<Models.public_RawJob>;
export type SearchSegmentRunRow = Row<Models.public_SearchSegmentRun>;
/** An address as callers write it; optional parts may be left out. */
export type Address = {
  line1: string;
  line2?: string | null;
  city: string;
  postalCode?: string | null;
  state?: string | null;
  country: string;
};

/** The stored form, with every optional part present as `null`. */
export function toStoredAddress(address: Address): AddressInput {
  return {
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    postalCode: address.postalCode ?? null,
    state: address.state ?? null,
    country: address.country,
  };
}
