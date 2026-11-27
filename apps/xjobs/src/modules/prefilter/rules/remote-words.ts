/** One list per language, so the spec's word table maps one to one. */
export const ENGLISH: readonly string[] = [
  'remote',
  'remotely',
  'telecommute',
  'telecommuting',
  'telework',
  'teleworking',
  'work from home',
  'working from home',
  'work-from-home',
  'WFH',
  'home office',
  'home-based',
  'fully distributed',
  'distributed team',
  'work from anywhere',
  'from anywhere',
  'from everywhere',
  'anywhere in',
  'virtual',
];
export const FRENCH: readonly string[] = [
  'télétravail',
  'teletravail',
  'à distance',
  'a distance',
  'distanciel',
  'full remote',
];
export const SPANISH: readonly string[] = [
  'remoto',
  'remota',
  'teletrabajo',
  'a distancia',
  'desde casa',
  'desde donde',
];
export const PORTUGUESE: readonly string[] = [
  'remoto',
  'remota',
  'trabalho remoto',
  'à distância',
  'home office',
];
export const GERMAN: readonly string[] = [
  'Homeoffice',
  'Home-Office',
  'mobiles Arbeiten',
  'mobile Arbeit',
  'ortsunabhängig',
  'Fernarbeit',
];
export const ITALIAN: readonly string[] = [
  'da remoto',
  'telelavoro',
  'smart working',
  'lavoro agile',
];
export const POLISH: readonly string[] = [
  'zdalnie',
  'zdalna',
  'zdalny',
  'praca zdalna',
];
export const DUTCH: readonly string[] = ['thuiswerken', 'op afstand'];
/** Russian entries are stems already. */
export const RUSSIAN: readonly string[] = ['удалённ', 'удаленн'];

/** Word stems that match as prefixes, so every ending is caught. */
const STEMS: readonly string[] = [
  'telecommut',
  'zdaln',
  'удал[её]нн',
  'remot[oa]',
];

const LEFT = '(?<![\\p{L}\\p{N}])';
const RIGHT = '(?![\\p{L}\\p{N}])';

function escape(phrase: string): string {
  return phrase
    .normalize('NFKC')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

const PREFIX_ENTRIES = new Set<string>(RUSSIAN);
const WHOLE_WORD_PHRASES = [
  ...new Set(
    [
      ENGLISH,
      FRENCH,
      SPANISH,
      PORTUGUESE,
      GERMAN,
      ITALIAN,
      POLISH,
      DUTCH,
    ].flat(),
  ),
];

const PATTERN = new RegExp(
  [
    ...STEMS.map((s) => `${LEFT}${s}`),
    ...[...PREFIX_ENTRIES].map((s) => `${LEFT}${escape(s)}`),
    ...WHOLE_WORD_PHRASES.map((p) => `${LEFT}${escape(p)}${RIGHT}`),
  ].join('|'),
  'iu',
);

/** The first remote word or phrase in the text, or null. */
export function mentionsRemote(text: string): string | null {
  const match = PATTERN.exec(text.normalize('NFKC'));
  return match ? match[0] : null;
}
