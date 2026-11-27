/** The Preferences sections' titles, shared by the nav, the pages and their document titles. */
export const SECTION_TITLES = {
  contacts: 'Contacts',
  webhook: 'Webhook',
  blockedAuthors: 'Blocked authors',
  eligibility: 'Where you can work',
  job: 'The job you want',
  terms: 'Location and terms',
  resume: 'Resume',
} as const;

/** The document title of a Preferences page: "<section> · Preferences · 10xjobs". */
export const preferencesTitle = (section: string) =>
  `${section} · Preferences · 10xjobs`;

/** The new-profile pages' section title. */
export const NEW_PROFILE_TITLE = 'New profile';
