import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { restsOn, type Check, type MatchProfile } from './types';

/** The job's contract type against the profile's `contractTypes`. */
export function checkContractType(
  facts: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const contract = facts.contractType.value;
  const base = {
    rule: 'contractType' as const,
    jobValue: contract,
    profileValue: profile.contractTypes,
  };
  if (contract === null || contract === 'unstated')
    return {
      ...base,
      outcome: 'unknown',
      reason: 'job does not state its contract type',
      ...restsOn(null),
    };
  const wanted = `[${profile.contractTypes.join(', ')}]`;
  const accepted = profile.contractTypes.includes(contract);
  return {
    ...base,
    outcome: accepted ? 'pass' : 'fail',
    reason: accepted
      ? `job contract ${contract} is in your contract types ${wanted}`
      : `job contract ${contract} is not in your contract types ${wanted}`,
    // Either way the outcome rests on the stated contract.
    ...restsOn(
      facts.contractType.confidence === 'unsure' ? 'contractType' : null,
    ),
  };
}
