import { BadRequestException } from '@nestjs/common';
import { Seniority } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import {
  assertHasSeniorities,
  normalizeSeniorities,
  SENIORITIES_REQUIRED,
} from './seniorities';

const { junior, senior, staff, unstated } = Seniority;
const profile: QuerySearchProfileInput = {
  position: 'backend_engineer',
  seniorities: [senior],
  locations: { remote: ['Europe'], hybrid: [], onsite: [] },
  skills: [],
  languages: ['en'],
};

describe('normalizeSeniorities', () => {
  it('dedupes and orders by the Seniority enum', () => {
    expect(
      normalizeSeniorities([staff, senior, staff, unstated, junior]),
    ).toEqual([junior, senior, staff, unstated]);
  });

  it('keeps an empty set empty', () => {
    expect(normalizeSeniorities([])).toEqual([]);
  });
});

describe('assertHasSeniorities', () => {
  it('rejects an empty set', () => {
    expect(() => assertHasSeniorities({ ...profile, seniorities: [] })).toThrow(
      new BadRequestException(SENIORITIES_REQUIRED),
    );
  });

  it('accepts a non-empty set', () => {
    expect(() => assertHasSeniorities(profile)).not.toThrow();
  });

  it('names the field in its message', () => {
    expect(SENIORITIES_REQUIRED).toBe(
      'seniorities must list at least one seniority',
    );
  });
});
