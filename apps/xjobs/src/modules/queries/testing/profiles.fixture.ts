import { Position, Seniority, SkillDomain, Technology } from 'src/common/enums';
import type {
  LocationsByArrangement,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  RankedSkill,
} from '../types';
import { sortKeys } from '../utils';

const skill = (
  technology: Technology,
  domain: SkillDomain,
  importance: number,
  mastery: number,
): RankedSkill => ({ technology, domain, importance, mastery });
const { backend, frontend, fullstack, devops, data, ml, qa } = SkillDomain;
const locations = (
  partial: Partial<LocationsByArrangement>,
): LocationsByArrangement => ({
  remote: [],
  hybrid: [],
  onsite: [],
  ...partial,
});

const remoteBackendMa: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  seniorities: [Seniority.senior],
  locations: locations({ remote: ['EMEA', 'European Union'] }),
  skills: [
    skill(Technology.nestjs, backend, 9, 8),
    skill(Technology.typescript, fullstack, 9, 7),
    skill(Technology.postgresql, backend, 6, 9),
  ],
};

const onsiteFrontendParis: QuerySearchProfileInput = {
  position: Position.frontend_engineer,
  seniorities: [Seniority.mid],
  locations: locations({ onsite: ['Paris, France'] }),
  skills: [
    skill(Technology.react, frontend, 9, 8),
    skill(Technology.nextjs, frontend, 8, 7),
  ],
};

/** Realistic mock profiles for the generation scenarios. */
export const MOCK_PROFILES = {
  remoteBackendMa,
  onsiteFrontendParis,
  hybridAndRemoteDevops: {
    position: Position.devops_engineer,
    seniorities: [Seniority.staff],
    locations: locations({
      hybrid: ['Austin, United States'],
      remote: ['North America'],
    }),
    skills: [
      skill(Technology.kubernetes, devops, 9, 9),
      skill(Technology.terraform, devops, 9, 9),
      skill(Technology.aws, devops, 9, 8),
    ],
  },
  unstatedSeniority: {
    position: Position.data_engineer,
    seniorities: [Seniority.unstated],
    locations: locations({ remote: ['Asia Pacific'] }),
    skills: [skill(Technology.python, data, 7, 7)],
  },
  onsiteOnlyCasablanca: {
    position: Position.backend_engineer,
    seniorities: [Seniority.junior],
    locations: locations({ onsite: ['Casablanca, Morocco'] }),
    skills: [
      skill(Technology.go, backend, 8, 6),
      skill(Technology.nodejs, backend, 5, 5),
    ],
  },
  remoteWorldwide: {
    position: Position.ml_engineer,
    seniorities: [Seniority.principal],
    locations: locations({ remote: ['Worldwide'] }),
    skills: [
      skill(Technology.pytorch, ml, 9, 9),
      skill(Technology.python, ml, 8, 9),
    ],
  },
  /** Nothing to search: every builder needs a skill domain. */
  noRankedSkills: {
    position: Position.qa_engineer,
    seniorities: [Seniority.senior],
    locations: locations({ remote: ['Spain'], onsite: ['Madrid, Spain'] }),
    skills: [skill(Technology.python, qa, 0, 6)],
  },
  leadTechLead: {
    position: Position.tech_lead,
    seniorities: [Seniority.lead],
    locations: locations({ onsite: ['London, United Kingdom'] }),
    skills: [skill(Technology.typescript, fullstack, 9, 9)],
  },
  tiesAndDuplicates: {
    position: Position.backend_engineer,
    seniorities: [Seniority.senior],
    locations: locations({ remote: ['European Union', 'european union '] }),
    skills: [
      skill(Technology.go, devops, 5, 5),
      skill(Technology.rust, backend, 5, 5),
      // The same technology under a second domain, ranked higher: backend wins.
      skill(Technology.go, backend, 8, 1),
      skill(Technology.java, backend, 0, 9),
    ],
  },
  messyLocation: {
    ...remoteBackendMa,
    locations: locations({ onsite: ['  Casablanca,   MOROCCO '] }),
  },
  sameLocationTwoArrangements: {
    ...remoteBackendMa,
    locations: locations({ hybrid: ['France'], onsite: ['france'] }),
  },
  /** Nothing to search: every list is empty. */
  noLocations: { ...remoteBackendMa, locations: locations({}) },
} satisfies Record<string, QuerySearchProfileInput>;

/** One sorted, readable line per recipe, for exact comparisons and snapshots. */
export function summarize(recipes: QuerySearchRecipe[]): string[] {
  return recipes
    .map(
      (recipe) =>
        `${recipe.channel} | ${recipe.domain} | ${recipe.type} | ${recipe.location} | ${recipe.keyword} | ${JSON.stringify(sortKeys(recipe.params))}`,
    )
    .sort();
}
