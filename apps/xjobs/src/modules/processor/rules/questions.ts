import type { ClosedQuestionKey, DecisionQuestion } from '../models/types';
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

const YES_NO_UNSTATED = ['yes', 'no', 'unstated'];

/** The approved codes plus `unstated` (once), since a posting may say nothing. */
function withUnstated(codes: string[]): string[] {
  return codes.includes('unstated') ? [...codes] : [...codes, 'unstated'];
}

/**
 * The closed questions Jev answers when it verifies a generated document, in
 * the order of the spec. Every question is a choice among the list's approved
 * codes plus `unstated`; booleans, junk flags and sponsorship are yes/no/unstated.
 * With `keys`, only those questions are built.
 */
export function buildVerificationQuestions(
  options: ListOptions,
  keys?: ReadonlySet<ClosedQuestionKey>,
): DecisionQuestion[] {
  const choice = (
    key: ClosedQuestionKey,
    choices: string[],
    instructions: string,
  ): DecisionQuestion => ({
    key,
    kind: 'choice',
    options: choices,
    instructions,
  });

  const all: DecisionQuestion[] = [
    choice(
      'arrangement',
      withUnstated(options.arrangements),
      'Where does the posting say the work is done: remote, hybrid or on site?',
    ),
    choice(
      'seniority',
      withUnstated(options.seniorities),
      'What seniority level does the posting ask for?',
    ),
    choice(
      'roleKind',
      withUnstated(options.roleKinds),
      'What kind of work is the job mostly, judged by its duties rather than its title?',
    ),
    choice(
      'contractType',
      withUnstated(options.contractTypes),
      'What contract type does the posting offer?',
    ),
    choice(
      'engagement',
      withUnstated(options.engagements),
      'How is the person engaged: as an employee, a contractor or another way?',
    ),
    choice(
      'isSoftwareEngineeringRole',
      [...YES_NO_UNSTATED],
      'Is the job mainly about building or running software?',
    ),
    ...options.junkFlags.map((code) =>
      choice(
        `junk:${code}`,
        [...YES_NO_UNSTATED],
        JUNK_INSTRUCTIONS[code] ??
          `Does the posting show the flag "${code.replace(/_/g, ' ')}"?`,
      ),
    ),
    choice(
      'sponsorshipOffered',
      [...YES_NO_UNSTATED],
      'Does the posting offer visa sponsorship?',
    ),
  ];
  return keys ? all.filter((q) => keys.has(q.key)) : all;
}

/** @deprecated Old name, kept for callers that only hash or print the questions. */
export const buildDecisionQuestions = buildVerificationQuestions;
