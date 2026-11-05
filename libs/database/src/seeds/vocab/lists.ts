/** The closed vocabularies the processor extracts against; each is its own list table. */
export const LIST_NAMES = [
  'techTags',
  'regions',
  'countries',
  'roleKinds',
  'seniorities',
  'arrangements',
  'contractTypes',
  'engagements',
  'junkFlags',
] as const;

export type ListName = (typeof LIST_NAMES)[number];
