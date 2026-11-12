import { checkContractType } from './contract';
import { exampleProfile, factsDoc } from './fixtures.testing';

const profile = {
  ...exampleProfile(),
  contractTypes: ['full_time', 'contract'],
};
const doc = (
  contractType: string | null,
  confidence: 'sure' | 'unsure' = 'sure',
) =>
  factsDoc((d) => {
    d.contractType.value = contractType;
    d.contractType.confidence = confidence;
  });

describe('checkContractType', () => {
  it('pass when in the list', () => {
    expect(checkContractType(doc('contract'), profile)).toMatchObject({
      rule: 'contractType',
      outcome: 'pass',
      jobValue: 'contract',
      profileValue: ['full_time', 'contract'],
      unsure: false,
    });
  });

  it('fail when not', () => {
    expect(checkContractType(doc('internship'), profile)).toMatchObject({
      outcome: 'fail',
      unsure: false,
      unsureField: null,
    });
  });

  it('unknown when unstated', () => {
    for (const value of ['unstated', null])
      expect(checkContractType(doc(value, 'unsure'), profile)).toMatchObject({
        outcome: 'unknown',
        unsure: false,
      });
  });

  it('an unsure contract failure is unsure', () => {
    expect(
      checkContractType(doc('internship', 'unsure'), profile),
    ).toMatchObject({
      outcome: 'fail',
      unsure: true,
      unsureField: 'contractType',
    });
  });

  it('a pass on an unsure contract rests on it', () => {
    expect(checkContractType(doc('contract', 'unsure'), profile)).toMatchObject(
      { outcome: 'pass', unsure: true, unsureField: 'contractType' },
    );
  });
});
