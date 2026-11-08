import { ENGINEERING_ROLE_KINDS } from '../vocab/seed-data';
import { MemoryVocabRepository } from '../testing/fakes';
import { matchingForms } from './vocab.repository';

const row = (
  code: string,
  label: string,
  aliases: string[] = [],
  status = 'approved',
) => ({ code, label, aliases, status, occurrences: 0 });

describe('matchingForms', () => {
  it('maps lower-cased codes, labels and aliases of approved rows to the code', () => {
    const forms = matchingForms([row('nextjs', 'Next.js', ['next js '])]);
    expect(forms).toEqual(
      new Map([
        ['nextjs', 'nextjs'],
        ['next.js', 'nextjs'],
        ['next js', 'nextjs'],
      ]),
    );
  });

  it('leaves proposed rows out', () => {
    const forms = matchingForms([row('bun', 'Bun', [], 'proposed')]);
    expect(forms.size).toBe(0);
  });

  it('never lets a label or an alias redirect another code', () => {
    const forms = matchingForms([
      row('go', 'Go', ['golang']),
      row('golang_tools', 'Go', ['go']),
    ]);
    expect(forms.get('go')).toBe('go');
    expect(forms.get('golang_tools')).toBe('golang_tools');
  });
});

describe('MemoryVocabRepository.snapshot', () => {
  it('names the seed engineering role kinds', async () => {
    const { engineeringRoleKinds } =
      await new MemoryVocabRepository().snapshot();
    expect([...engineeringRoleKinds].sort()).toEqual(
      [...ENGINEERING_ROLE_KINDS].sort(),
    );
    expect(engineeringRoleKinds.has('support')).toBe(false);
  });
});
