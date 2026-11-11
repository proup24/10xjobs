// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { JobAnswers } from './answers';
import { nextSetupStep, type SetupSnapshot } from './next-step';
import { stepPath } from './steps';

const job: JobAnswers = {
  position: 'backend_engineer',
  yearsOfExperience: 5,
  seniorities: ['senior'],
  techs: [{ code: 'typescript', rating: 4 }],
  languages: [{ lang: 'en', level: 'fluent' }],
};

const finished: SetupSnapshot = {
  name: 'Ada',
  residenceCountry: 'DE',
  acceptsSponsorship: false,
  draft: null,
  profile: { id: 'p1', hasResume: true },
};

describe('nextSetupStep', () => {
  it('1. no name → about', () => {
    expect(nextSetupStep({ ...finished, name: null })).toBe('about');
  });

  it('1. a blank name counts as no name', () => {
    expect(nextSetupStep({ ...finished, name: '  ' })).toBe('about');
  });

  it('2. no residence country → eligibility', () => {
    expect(nextSetupStep({ ...finished, residenceCountry: null })).toBe(
      'eligibility',
    );
  });

  it('2. sponsorship unanswered → eligibility', () => {
    expect(nextSetupStep({ ...finished, acceptsSponsorship: null })).toBe(
      'eligibility',
    );
  });

  it('3. no profile and no step-3 answers in the draft → job', () => {
    expect(nextSetupStep({ ...finished, profile: null })).toBe('job');
    expect(
      nextSetupStep({ ...finished, profile: null, draft: { version: 1 } }),
    ).toBe('job');
  });

  it('4. no profile but step-3 answers in the draft → terms', () => {
    expect(
      nextSetupStep({ ...finished, profile: null, draft: { version: 1, job } }),
    ).toBe('terms');
  });

  it('5. a profile without a resume → resume', () => {
    expect(
      nextSetupStep({ ...finished, profile: { id: 'p1', hasResume: false } }),
    ).toBe('resume');
  });

  it('6. otherwise done', () => {
    expect(nextSetupStep(finished)).toBe('done');
  });

  it('applies the rules in order: a profile with resume but null name → about', () => {
    expect(nextSetupStep({ ...finished, name: null })).toBe('about');
  });
});

describe('stepPath', () => {
  it('is /setup/<id>', () => {
    expect(stepPath('terms')).toBe('/setup/terms');
    expect(stepPath('review')).toBe('/setup/review');
  });
});
