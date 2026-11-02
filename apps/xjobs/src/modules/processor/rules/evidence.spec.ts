import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Evidence } from '../models/types';
import { contradictsEvidence, resetEvidenceWarnings } from './evidence';

const ev = (p: Partial<Evidence>): Evidence => ({
  location: null,
  contractType: null,
  experienceLevel: null,
  salary: null,
  ...p,
});

describe('contradictsEvidence', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetEvidenceWarnings();
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('logs an unmapped value once', () => {
    const e = ev({ experienceLevel: 'Weird level' });
    contradictsEvidence('seniority', 'junior', e);
    contradictsEvidence('seniority', 'senior', e);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('allows every code in the mapped set', () => {
    const e = ev({ experienceLevel: 'Mid-Senior level' });
    expect(contradictsEvidence('seniority', 'senior', e)).toBe(false);
    expect(contradictsEvidence('seniority', 'junior', e)).toBe(true);
  });

  it('compares contract type with the ambiguous sets', () => {
    expect(
      contradictsEvidence(
        'contractType',
        'contract',
        ev({ contractType: 'Full-time' }),
      ),
    ).toBe(true);
    expect(
      contradictsEvidence(
        'contractType',
        'freelance',
        ev({ contractType: 'Contract' }),
      ),
    ).toBe(false);
  });

  it('never compares other keys', () => {
    expect(
      contradictsEvidence(
        'engagement',
        'contractor',
        ev({ contractType: 'Full-time' }),
      ),
    ).toBe(false);
    expect(
      contradictsEvidence('arrangement', 'remote', ev({ location: 'Paris' })),
    ).toBe(false);
  });

  it('treats unstated and unmapped values as no contradiction', () => {
    expect(
      contradictsEvidence(
        'seniority',
        'unstated',
        ev({ experienceLevel: 'Associate' }),
      ),
    ).toBe(false);
    expect(
      contradictsEvidence(
        'seniority',
        'junior',
        ev({ experienceLevel: 'Unknown level' }),
      ),
    ).toBe(false);
    expect(contradictsEvidence('seniority', 'junior', ev({}))).toBe(false);
  });
});
