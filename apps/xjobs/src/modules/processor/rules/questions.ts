import type { DecisionQuestion } from '../models/types';
import type { ListOptions } from '../schema';

const JUNK_INSTRUCTIONS: Record<string, string> = {
  title_description_mismatch:
    'Does the title name a different job from the one the description describes?',
  multi_city_template:
    'Is this one template posted for many cities, with the place swapped in?',
  data_harvesting:
    'Does the posting look like a way to collect applicants’ data rather than fill a role?',
  vague:
    'Is the posting too vague to tell what the job is, with little about duties or requirements?',
};

/** The closed questions Jev answers, in the order of the spec; options come from the approved lists. */
export function buildDecisionQuestions(
  options: ListOptions,
): DecisionQuestion[] {
  return [
    {
      key: 'arrangement',
      kind: 'choice',
      options: options.arrangements,
      instructions:
        'Where does the posting say the work is done: remote, hybrid or on site?',
    },
    {
      key: 'seniority',
      kind: 'choice',
      options: options.seniorities,
      instructions: 'What seniority level does the posting ask for?',
    },
    {
      key: 'roleKind',
      kind: 'choice',
      options: options.roleKinds,
      instructions:
        'What kind of work is the job mostly, judged by its duties rather than its title?',
    },
    {
      key: 'contractType',
      kind: 'choice',
      options: options.contractTypes,
      instructions: 'What contract type does the posting offer?',
    },
    {
      key: 'engagement',
      kind: 'choice',
      options: options.engagements,
      instructions:
        'How is the person engaged: as an employee, a contractor or another way?',
    },
    {
      key: 'isSoftwareEngineeringRole',
      kind: 'yesno',
      instructions: 'Is the job mainly about building or running software?',
    },
    ...options.junkFlags.map(
      (code): DecisionQuestion => ({
        key: `junk:${code}`,
        kind: 'yesno',
        instructions:
          JUNK_INSTRUCTIONS[code] ??
          `Does the posting show the flag "${code.replace(/_/g, ' ')}"?`,
      }),
    ),
    {
      key: 'sponsorshipOffered',
      kind: 'choice',
      options: ['yes', 'no', 'unstated'],
      instructions: 'Does the posting offer visa sponsorship?',
    },
  ];
}
