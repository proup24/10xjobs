import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import type { ExtractionDocument } from 'src/modules/processor/schema';
import type { MatchProfile } from './types';

export const CITY_A = '00000000-0000-4000-8000-00000000000a';
export const CITY_B = '00000000-0000-4000-8000-00000000000b';

export function exampleProfile(): MatchProfile {
  const skill = (technology: string, mastery: number, importance: number) => ({
    technology,
    mastery,
    importance,
  });
  return {
    id: 'profile-1',
    userId: 'user-1',
    position: 'backend_engineer',
    seniorities: ['senior'],
    yearsOfExperience: 5,
    timezoneMin: -300,
    timezoneMax: 300,
    locations: {
      remote: [{ kind: 'worldwide' }],
      hybrid: [
        { kind: 'city', id: CITY_A },
        { kind: 'city', id: CITY_B },
      ],
      onsite: [
        { kind: 'city', id: CITY_A },
        { kind: 'city', id: CITY_B },
      ],
    },
    skills: [
      skill('python', 9, 10),
      skill('nestjs', 9, 10),
      skill('go', 8, 10),
      skill('rabbitmq', 10, 8),
      skill('postgresql', 8, 8),
      skill('redis', 7, 6),
      skill('docker', 7, 6),
      skill('aws', 6, 5),
    ],
  };
}

/** A copy of the fixture extraction with `edit` applied to it. */
export function jobDoc(
  edit?: (doc: ExtractionDocument) => void,
): ExtractionDocument {
  const doc = structuredClone(fixtureDocument());
  edit?.(doc);
  return doc;
}
