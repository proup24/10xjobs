import type { ExtractionDocument } from '../schema';

export interface TypedColumns {
  arrangement: string | null;
  seniority: string | null;
  roleKind: string | null;
  contractType: string | null;
  engagement: string | null;
  isSoftwareEngineeringRole: boolean | null;
  worldwide: boolean;
  regionCodes: string[];
  countryCodes: string[];
  cityIds: string[];
  techTags: string[];
  mainStackTags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
}

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort();

const codesOf = (terms: readonly { code: string | null }[]): string[] =>
  terms.flatMap((t) => (t.code === null ? [] : [t.code]));

/** The filterable columns of a job_extractions row, derived from its document. */
export function deriveTypedColumns(
  doc: ExtractionDocument,
  regionCountries: ReadonlyMap<string, readonly string[]>,
): TypedColumns {
  const regions: string[] = [];
  const countries: string[] = [];
  const cities: string[] = [];
  let worldwide = false;
  for (const opening of doc.openings) {
    for (const place of opening.places) {
      if (place.kind === 'worldwide') worldwide = true;
      else if (place.kind === 'region') {
        regions.push(place.code);
        countries.push(...(regionCountries.get(place.code) ?? []));
      } else if (place.kind === 'country') countries.push(place.code);
      else {
        if (place.countryCode !== null) countries.push(place.countryCode);
        if (place.cityId !== null) cities.push(place.cityId);
      }
    }
  }

  const stack = doc.techStack.value;
  const mainStack = stack
    ? stack.mainStack.flatMap((g) => codesOf(g.anyOf))
    : [];
  const mustHaves = stack
    ? stack.mustHaves.flatMap((g) => codesOf(g.anyOf))
    : [];
  const niceToHaves = stack ? codesOf(stack.niceToHaves) : [];
  const salary = doc.salary.value;

  return {
    arrangement: doc.arrangement.value,
    seniority: doc.seniority.value,
    roleKind: doc.position.value?.roleKind ?? null,
    contractType: doc.contractType.value,
    engagement: doc.engagement.value,
    isSoftwareEngineeringRole: doc.isSoftwareEngineeringRole.value,
    worldwide,
    regionCodes: uniqueSorted(regions),
    countryCodes: uniqueSorted(countries),
    cityIds: uniqueSorted(cities),
    techTags: uniqueSorted([...mainStack, ...mustHaves, ...niceToHaves]),
    mainStackTags: uniqueSorted(mainStack),
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
  };
}
