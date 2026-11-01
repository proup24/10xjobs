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
export type SearchSegmentRunRow = Row<Models.public_SearchSegmentRun>;
export type CollectionBatchRow = Row<Models.public_CollectionBatch>;
export type RawItemRow = Row<Models.public_RawItem>;
export type RawItemVersionRow = Row<Models.public_RawItemVersion>;
export type RawItemSightingRow = Row<Models.public_RawItemSighting>;
export type NormalizedVersionRow = Row<Models.public_NormalizedVersion>;
export type NormalizedJobRow = Row<Models.public_NormalizedJob>;
export type NormalizedJobSourceRow = Row<Models.public_NormalizedJobSource>;
export type JobExtractionRow = Row<Models.public_JobExtraction>;
export type ProcessingAttemptRow = Row<Models.public_ProcessingAttempt>;
export type TechTagRow = Row<Models.public_TechTag>;
export type RegionTermRow = Row<Models.public_RegionTerm>;
export type CountryRow = Row<Models.public_Country>;
export type RegionCountryRow = Row<Models.public_RegionCountry>;
export type CityRow = Row<Models.public_City>;
export type RoleKindRow = Row<Models.public_RoleKind>;
export type SeniorityTermRow = Row<Models.public_SeniorityTerm>;
export type ArrangementTermRow = Row<Models.public_ArrangementTerm>;
export type ContractTypeRow = Row<Models.public_ContractType>;
export type EngagementTermRow = Row<Models.public_EngagementTerm>;
export type JunkFlagRow = Row<Models.public_JunkFlag>;
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
