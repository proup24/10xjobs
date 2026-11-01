import { BadRequestException } from '@nestjs/common';
import { Arrangement, Position, Region, Seniority } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import { assertLocatable, CITY_REQUIRED, isLocatable } from './locatable';

const input: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  regions: [Region.EMEA],
  arrangements: [Arrangement.onsite],
  seniority: Seniority.senior,
  country: 'MA',
  city: null,
  skills: [],
};

describe('isLocatable', () => {
  it('rejects onsite without a city', () => {
    expect(isLocatable([Arrangement.onsite], null)).toBe(false);
  });

  it('rejects hybrid with a blank city', () => {
    expect(isLocatable([Arrangement.hybrid], '  ')).toBe(false);
  });

  it('rejects onsite next to remote without a city', () => {
    expect(
      isLocatable([Arrangement.remote, Arrangement.onsite], undefined),
    ).toBe(false);
  });

  it('accepts remote without a city', () => {
    expect(isLocatable([Arrangement.remote], null)).toBe(true);
  });

  it('accepts onsite with a city', () => {
    expect(isLocatable([Arrangement.onsite], 'Paris')).toBe(true);
  });
});

describe('assertLocatable', () => {
  it('throws a 400 with the city message for onsite without a city', () => {
    expect(() => assertLocatable(input)).toThrow(BadRequestException);
    expect(() => assertLocatable(input)).toThrow(CITY_REQUIRED);
  });

  it('does not throw for remote with no regions', () => {
    expect(() =>
      assertLocatable({
        ...input,
        arrangements: [Arrangement.remote],
        regions: [],
      }),
    ).not.toThrow();
  });
});
