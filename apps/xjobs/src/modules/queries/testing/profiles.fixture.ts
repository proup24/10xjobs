import { SkillDomain } from 'src/common/enums';
import type {
  LocationsByArrangement,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  RankedSkill,
} from '../types';
import { sortKeys } from '../utils';

const skill = (
  technology: string,
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
  position: 'backend_engineer',
  seniorities: ['senior'],
  languages: ['en'],
  locations: locations({ remote: ['EMEA', 'European Union'] }),
  skills: [
    skill('nestjs', backend, 9, 8),
    skill('typescript', fullstack, 9, 7),
    skill('postgresql', backend, 6, 9),
  ],
};

const onsiteFrontendParis: QuerySearchProfileInput = {
  position: 'frontend_engineer',
  seniorities: ['mid'],
  languages: ['en'],
  locations: locations({ onsite: ['Paris, France'] }),
  skills: [skill('react', frontend, 9, 8), skill('nextjs', frontend, 8, 7)],
};

/** Realistic mock profiles for the generation scenarios. */
export const MOCK_PROFILES = {
  remoteBackendMa,
  onsiteFrontendParis,
  hybridAndRemoteDevops: {
    position: 'devops_engineer',
    seniorities: ['staff'],
    languages: ['en'],
    locations: locations({
      hybrid: ['Austin, United States'],
      remote: ['North America'],
    }),
    skills: [
      skill('kubernetes', devops, 9, 9),
      skill('terraform', devops, 9, 9),
      skill('aws', devops, 9, 8),
    ],
  },
  unstatedSeniority: {
    position: 'data_engineer',
    seniorities: ['unstated'],
    languages: ['en'],
    locations: locations({ remote: ['Asia Pacific'] }),
    skills: [skill('python', data, 7, 7)],
  },
  onsiteOnlyCasablanca: {
    position: 'backend_engineer',
    seniorities: ['junior'],
    languages: ['en'],
    locations: locations({ onsite: ['Casablanca, Morocco'] }),
    skills: [skill('go', backend, 8, 6), skill('nodejs', backend, 5, 5)],
  },
  remoteWorldwide: {
    position: 'ml_engineer',
    seniorities: ['principal'],
    languages: ['en'],
    locations: locations({ remote: ['Worldwide'] }),
    skills: [skill('pytorch', ml, 9, 9), skill('python', ml, 8, 9)],
  },
  /** Nothing to search: every builder needs a skill domain. */
  noRankedSkills: {
    position: 'qa_engineer',
    seniorities: ['senior'],
    languages: ['en'],
    locations: locations({ remote: ['Spain'], onsite: ['Madrid, Spain'] }),
    skills: [skill('python', qa, 0, 6)],
  },
  /** Concept tags only: no tech with search wording, so nothing is searched. */
  conceptTagsOnly: {
    position: 'backend_engineer',
    seniorities: ['senior'],
    languages: ['en'],
    locations: locations({ remote: ['EMEA'] }),
    skills: [
      skill('saas', backend, 10, 9),
      skill('microservices', backend, 9, 9),
    ],
  },
  leadTechLead: {
    position: 'tech_lead',
    seniorities: ['lead'],
    languages: ['en'],
    locations: locations({ onsite: ['London, United Kingdom'] }),
    skills: [skill('typescript', fullstack, 9, 9)],
  },
  tiesAndDuplicates: {
    position: 'backend_engineer',
    seniorities: ['senior'],
    languages: ['en'],
    locations: locations({ remote: ['European Union', 'european union '] }),
    skills: [
      skill('go', devops, 5, 5),
      skill('rust', backend, 5, 5),
      // The same technology under a second domain, ranked higher: backend wins.
      skill('go', backend, 8, 1),
      skill('java', backend, 0, 9),
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
