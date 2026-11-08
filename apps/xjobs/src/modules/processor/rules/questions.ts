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

type FixedKey = Exclude<ClosedQuestionKey, `junk:${string}`>;

const INSTRUCTIONS: Record<FixedKey, string> = {
  arrangement:
    'Where does the posting say the work is done: remote, hybrid or on site?',
  seniority: 'What seniority level does the posting ask for?',
  roleKind:
    'What kind of work is the job mostly, judged by its duties rather than its title?',
  contractType: 'What contract type does the posting offer?',
  engagement:
    'How is the person engaged: as an employee, a contractor or another way?',
  isSoftwareEngineeringRole:
    'Is the job mainly about building or running software?',
  sponsorshipOffered: 'Does the posting offer visa sponsorship?',
};

/** The question Jev is asked for a field; also quoted in the generator's regeneration feedback. */
export function instructionsFor(key: ClosedQuestionKey): string {
  if (!key.startsWith('junk:')) return INSTRUCTIONS[key as FixedKey];
  const code = key.slice('junk:'.length);
  return (
    JUNK_INSTRUCTIONS[code] ??
    `Does the posting show the flag "${code.replace(/_/g, ' ')}"?`
  );
}

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
  ): DecisionQuestion => ({
    key,
    kind: 'choice',
    options: choices,
    instructions: instructionsFor(key),
  });

  const all: DecisionQuestion[] = [
    choice('arrangement', withUnstated(options.arrangements)),
    choice('seniority', withUnstated(options.seniorities)),
    choice('roleKind', withUnstated(options.roleKinds)),
    choice('contractType', withUnstated(options.contractTypes)),
    choice('engagement', withUnstated(options.engagements)),
    choice('isSoftwareEngineeringRole', [...YES_NO_UNSTATED]),
    ...options.junkFlags.map((code) =>
      choice(`junk:${code}`, [...YES_NO_UNSTATED]),
    ),
    choice('sponsorshipOffered', [...YES_NO_UNSTATED]),
  ];
  return keys ? all.filter((q) => keys.has(q.key)) : all;
}
