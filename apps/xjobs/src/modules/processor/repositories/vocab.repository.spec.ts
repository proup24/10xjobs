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

describe('MemoryVocabRepository.upsertCities', () => {
  const withFes = () => {
    const vocab = new MemoryVocabRepository();
    vocab.cities.push({
      id: 'fes-id',
      name: 'Fès',
      countryCode: 'MA',
      aliases: ['Fez'],
      status: 'approved',
      occurrences: 4,
    });
    return vocab;
  };

  it('maps "Fez" to the existing Fès', async () => {
    const vocab = withFes();
    const ids = await vocab.upsertCities([{ name: 'Fez', countryCode: 'MA' }]);
    expect(ids.get('Fez|MA')).toBe('fes-id');
    expect(vocab.cities).toHaveLength(1);
    expect(vocab.cities[0].occurrences).toBe(5);
  });

  it('maps "Fes" to Fès', async () => {
    const vocab = withFes();
    const ids = await vocab.upsertCities([{ name: 'Fes', countryCode: 'MA' }]);
    expect(ids.get('Fes|MA')).toBe('fes-id');
    expect(vocab.cities).toHaveLength(1);
  });

  it('creates a proposed city for an unknown name', async () => {
    const vocab = withFes();
    const ids = await vocab.upsertCities([
      { name: 'Rabat', countryCode: 'MA' },
    ]);
    expect(vocab.cities).toHaveLength(2);
    expect(vocab.cities[1]).toMatchObject({
      name: 'Rabat',
      status: 'proposed',
      occurrences: 1,
    });
    expect(ids.get('Rabat|MA')).toBe(vocab.cities[1].id);
  });

  it('maps a spelling the same way cityForms does when two cities share it', async () => {
    const vocab = new MemoryVocabRepository();
    vocab.cities.push(
      {
        id: 'proposed-fes',
        name: 'Fes',
        countryCode: 'MA',
        status: 'proposed',
        occurrences: 1,
      },
      {
        id: 'approved-fes',
        name: 'Fès',
        countryCode: 'MA',
        aliases: ['Fes'],
        status: 'approved',
        occurrences: 1,
      },
    );
    const ids = await vocab.upsertCities([{ name: 'Fes', countryCode: 'MA' }]);
    expect(ids.get('Fes|MA')).toBe('approved-fes');
  });

  it('does not create a city whose name folds to nothing', async () => {
    const vocab = new MemoryVocabRepository();
    const ids = await vocab.upsertCities([{ name: ' - ', countryCode: 'MA' }]);
    expect(vocab.cities).toHaveLength(0);
    expect(ids.size).toBe(0);
  });
});
