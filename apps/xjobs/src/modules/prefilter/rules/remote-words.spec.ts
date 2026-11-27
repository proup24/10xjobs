import { mentionsRemote } from './remote-words';

describe('mentionsRemote', () => {
  it.each([
    ['English', 'You can telecommute twice a week'],
    ['French', 'Télétravail possible 3 jours'],
    ['Spanish', 'Trabajo desde casa'],
    ['Portuguese', 'Trabalho remoto'],
    ['German', 'Homeoffice möglich'],
    ['Italian', 'Lavoro agile e smart working'],
    ['Polish', 'Praca zdalna'],
    ['Dutch', 'Thuiswerken kan'],
    ['Russian', 'Удалённая работа'],
  ])('matches a %s phrase', (_lang, text) => {
    expect(mentionsRemote(text)).not.toBeNull();
  });

  it('matches stems with any ending', () => {
    expect(mentionsRemote('Teleworking')).toBe('Teleworking');
    expect(mentionsRemote('rola zdalna')).toBe('zdaln');
    expect(mentionsRemote('удаленная')).toBe('удаленн');
  });

  it('matches remote in "(Remote)"', () => {
    expect(mentionsRemote('Engineer (Remote)')).toBe('Remote');
  });

  it('matches remote-first and words at line edges', () => {
    expect(mentionsRemote('We are remote-first')).toBe('remote');
    expect(mentionsRemote('Great team\nremote\nand more')).toBe('remote');
  });

  it('matches the bold title "𝗥𝗲𝗺𝗼𝘁𝗲 (𝗘𝗨)"', () => {
    expect(mentionsRemote('𝗥𝗲𝗺𝗼𝘁𝗲 (𝗘𝗨)')).toBe('Remote');
  });

  it('matches "working from home"', () => {
    expect(mentionsRemote('Options for working from home')).toBe(
      'working from home',
    );
  });

  it('tolerates a line break inside a phrase', () => {
    expect(mentionsRemote('work from\n  home')).not.toBeNull();
  });

  it('matches "anywhere in the US"', () => {
    expect(mentionsRemote('Live anywhere in the US')).toBe('anywhere in');
  });

  it('does not match "hybrid", "flexible working" or "flexibility"', () => {
    expect(mentionsRemote('hybrid')).toBeNull();
    expect(mentionsRemote('flexible working')).toBeNull();
    expect(mentionsRemote('flexibility')).toBeNull();
  });

  it('does not match "remotely" inside another word', () => {
    expect(mentionsRemote('unremotely')).toBeNull();
  });

  it('does not match "virtual" inside "virtualization"', () => {
    expect(mentionsRemote('virtualization engineer')).toBeNull();
  });
});
