/** What a user must answer before publishing: null until answered. */
export type Eligibility = {
  residenceCountry: string | null;
  acceptsSponsorship: boolean | null;
};
