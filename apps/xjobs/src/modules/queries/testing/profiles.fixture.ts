import {
  Arrangement,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import type {
  QuerySearchProfileInput,
  QuerySearchRecipe,
  RankedSkill,
} from '../types';
import { sortKeys } from '../utils';

const skill = (
  technology: Technology,
  importance: number,
  mastery: number,
): RankedSkill => ({ technology, importance, mastery });

const remoteBackendMa: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  seniority: Seniority.senior,
  regions: [Region.EMEA, Region.EU],
  arrangements: [Arrangement.remote],
  country: 'MA',
  city: 'Casablanca',
  skills: [
    skill(Technology.nestjs, 9, 8),
    skill(Technology.typescript, 9, 7),
    skill(Technology.postgresql, 6, 9),
  ],
};

const onsiteFrontendParis: QuerySearchProfileInput = {
  position: Position.frontend_engineer,
  seniority: Seniority.mid,
  regions: [Region.EUROPE],
  arrangements: [Arrangement.onsite],
  country: 'FR',
  city: 'Paris',
  skills: [skill(Technology.react, 9, 8), skill(Technology.nextjs, 8, 7)],
};

/** Realistic mock profiles for the generation scenarios. */
export const MOCK_PROFILES = {
  remoteBackendMa,
  onsiteFrontendParis,
  hybridAndRemoteDevops: {
    position: Position.devops_engineer,
    seniority: Seniority.staff,
    regions: [Region.NORTH_AMERICA],
    arrangements: [Arrangement.hybrid, Arrangement.remote],
    country: 'US',
    city: 'Austin',
    skills: [
      skill(Technology.kubernetes, 9, 9),
      skill(Technology.terraform, 9, 9),
      skill(Technology.aws, 9, 8),
    ],
  },
  unstatedOnly: {
    position: Position.data_engineer,
    seniority: Seniority.unstated,
    regions: [Region.APAC],
    arrangements: [Arrangement.unstated],
    country: 'SG',
    city: null,
    skills: [skill(Technology.python, 7, 7)],
  },
  unstatedWithOnsite: {
    position: Position.backend_engineer,
    seniority: Seniority.junior,
    regions: [Region.MENA],
    arrangements: [Arrangement.onsite, Arrangement.unstated],
    country: 'MA',
    city: 'Rabat',
    skills: [skill(Technology.go, 8, 6), skill(Technology.nodejs, 5, 5)],
  },
  noRegionsRemote: {
    position: Position.ml_engineer,
    seniority: Seniority.principal,
    regions: [],
    arrangements: [Arrangement.remote],
    country: 'DE',
    city: null,
    skills: [skill(Technology.pytorch, 9, 9), skill(Technology.python, 8, 9)],
  },
  noTechnologies: {
    position: Position.qa_engineer,
    seniority: Seniority.senior,
    regions: [Region.EU],
    arrangements: [Arrangement.remote, Arrangement.onsite],
    country: 'ES',
    city: 'Madrid',
    skills: [],
  },
  leadTechLead: {
    position: Position.tech_lead,
    seniority: Seniority.lead,
    regions: [Region.UK],
    arrangements: [Arrangement.onsite],
    country: 'GB',
    city: 'London',
    skills: [skill(Technology.typescript, 9, 9)],
  },
  tiesAndDuplicates: {
    position: Position.backend_engineer,
    seniority: Seniority.senior,
    regions: [Region.EU, Region.EU],
    arrangements: [Arrangement.remote],
    country: 'NL',
    city: null,
    skills: [
      skill(Technology.go, 5, 5),
      skill(Technology.rust, 5, 5),
      // The same technology under a second domain, ranked higher.
      skill(Technology.go, 8, 1),
      skill(Technology.java, 0, 9),
    ],
  },
  messyLocation: {
    ...remoteBackendMa,
    arrangements: [Arrangement.onsite],
    country: ' ma ',
    city: '  Casablanca ',
  },
  missingCity: { ...onsiteFrontendParis, city: '   ' },
} satisfies Record<string, QuerySearchProfileInput>;

/** One sorted, readable line per recipe, for exact comparisons and snapshots. */
export function summarize(recipes: QuerySearchRecipe[]): string[] {
  return recipes
    .map(
      (recipe) =>
        `${recipe.channel} | ${recipe.type} | ${recipe.locationRegion ?? '-'} | ${recipe.city ?? '-'}, ${recipe.country ?? '-'} | ${recipe.keyword} | ${JSON.stringify(sortKeys(recipe.params))}`,
    )
    .sort();
}
