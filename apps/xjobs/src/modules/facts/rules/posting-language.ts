import { francAll } from 'franc';

/**
 * The languages a posting is written in (ISO 639-1), and whether the detector is sure of them.
 * `codes` are the languages it is sure of. `closeCalls` are sets of close relatives it could
 * not tell apart (each sorted, ordered by detected characters, descending).
 */
export interface PostingLanguages {
  codes: string[];
  closeCalls: string[][];
  confident: boolean;
}

// Any franc upgrade or change to these thresholds or the table below changes the detected
// languages: bump FACTS_VERSION (facts/config/facts.config.ts) with it.

/** Below this many characters (of the text, and of its detected paragraphs) nothing is sure. */
const MIN_TEXT = 200;
/** A paragraph shorter than this is not detected (franc's `minLength`). */
const MIN_PARAGRAPH = 50;
/** A language is kept when its paragraphs hold at least this share of the detected characters. */
const MIN_SHARE = 0.25;
/**
 * A sentence piece is sure of a language only when every rival scores at least this far
 * below the winner (franc scores the winner 1); margins are judged per sentence piece, and
 * a close relative within the margin makes the piece a close call instead. Text mixing French and English sentences scores the
 * two within 0.004 to 0.056, and a bare list of tool names within 0.002; single-language
 * prose leaves a clear gap to its nearest unrelated rival.
 */
const MIN_MARGIN = 0.06;

/**
 * franc's ISO 639-3 codes to the ISO 639-1 codes of the `languages` vocabulary
 * (`iso_languages`), for every language franc can detect that has one. franc reports some
 * macrolanguages by a member (`arb` for Arabic, `pes` for Persian, `cmn` for Chinese).
 * Galician (`glg`) is left out on purpose: franc reads European Portuguese as Galician,
 * which would reject a Portuguese speaker.
 */
const ISO_639_1: Record<string, string> = {
  afr: 'af', // Afrikaans
  als: 'sq', // Albanian (Tosk)
  amh: 'am', // Amharic
  arb: 'ar', // Arabic (Standard)
  ayr: 'ay', // Aymara (Central)
  azj: 'az', // Azerbaijani (North)
  bam: 'bm', // Bambara
  bel: 'be', // Belarusian
  ben: 'bn', // Bengali
  bod: 'bo', // Tibetan
  bos: 'bs', // Bosnian
  bul: 'bg', // Bulgarian
  cat: 'ca', // Catalan
  ces: 'cs', // Czech
  ckb: 'ku', // Kurdish (Central)
  cmn: 'zh', // Chinese (Mandarin)
  dan: 'da', // Danish
  deu: 'de', // German
  ekk: 'et', // Estonian (Standard)
  ell: 'el', // Greek
  eng: 'en', // English
  epo: 'eo', // Esperanto
  ewe: 'ee', // Ewe
  fin: 'fi', // Finnish
  fra: 'fr', // French
  guj: 'gu', // Gujarati
  hat: 'ht', // Haitian
  hau: 'ha', // Hausa
  heb: 'he', // Hebrew
  hin: 'hi', // Hindi
  hrv: 'hr', // Croatian
  hun: 'hu', // Hungarian
  hye: 'hy', // Armenian
  ibo: 'ig', // Igbo
  iii: 'ii', // Sichuan Yi
  ind: 'id', // Indonesian
  ita: 'it', // Italian
  jav: 'jv', // Javanese
  jpn: 'ja', // Japanese
  kan: 'kn', // Kannada
  kat: 'ka', // Georgian
  kaz: 'kk', // Kazakh
  khk: 'mn', // Mongolian (Halh)
  khm: 'km', // Khmer
  kin: 'rw', // Kinyarwanda
  kir: 'ky', // Kirghiz
  kor: 'ko', // Korean
  lao: 'lo', // Lao
  lin: 'ln', // Lingala
  lit: 'lt', // Lithuanian
  lug: 'lg', // Ganda
  lvs: 'lv', // Latvian (Standard)
  mal: 'ml', // Malayalam
  mar: 'mr', // Marathi
  mkd: 'mk', // Macedonian
  mya: 'my', // Burmese
  ndo: 'ng', // Ndonga
  nld: 'nl', // Dutch
  nno: 'nn', // Norwegian Nynorsk
  nob: 'nb', // Norwegian Bokmål
  npi: 'ne', // Nepali
  nya: 'ny', // Nyanja
  pan: 'pa', // Punjabi
  pbu: 'ps', // Pashto (Northern)
  pes: 'fa', // Persian (Iranian)
  plt: 'mg', // Malagasy (Plateau)
  pol: 'pl', // Polish
  por: 'pt', // Portuguese
  prs: 'fa', // Persian (Dari)
  quy: 'qu', // Quechua (Ayacucho)
  quz: 'qu', // Quechua (Cusco)
  ron: 'ro', // Romanian
  run: 'rn', // Rundi
  rus: 'ru', // Russian
  sag: 'sg', // Sango
  sin: 'si', // Sinhala
  slk: 'sk', // Slovak
  slv: 'sl', // Slovenian
  sna: 'sn', // Shona
  som: 'so', // Somali
  sot: 'st', // Southern Sotho
  spa: 'es', // Spanish
  srp: 'sr', // Serbian
  ssw: 'ss', // Swati
  sun: 'su', // Sundanese
  swe: 'sv', // Swedish
  swh: 'sw', // Swahili
  tam: 'ta', // Tamil
  tat: 'tt', // Tatar
  tel: 'te', // Telugu
  tgk: 'tg', // Tajik
  tgl: 'tl', // Tagalog
  tha: 'th', // Thai
  tir: 'ti', // Tigrinya
  tsn: 'tn', // Tswana
  tso: 'ts', // Tsonga
  tuk: 'tk', // Turkmen
  tur: 'tr', // Turkish
  uig: 'ug', // Uighur
  ukr: 'uk', // Ukrainian
  urd: 'ur', // Urdu
  uzn: 'uz', // Uzbek (Northern)
  ven: 've', // Venda
  vie: 'vi', // Vietnamese
  wol: 'wo', // Wolof
  xho: 'xh', // Xhosa
  ydd: 'yi', // Yiddish (Eastern)
  yor: 'yo', // Yoruba
  zlm: 'ms', // Malay
  zul: 'zu', // Zulu
};

/**
 * franc picks only among mapped languages: unmapped neighbours (Scots scores 0.97 on plain
 * English) would otherwise take paragraphs that can't count.
 */
const ONLY = Object.keys(ISO_639_1);

/** Close relatives franc confuses, which a margin cannot separate. ISO 639-1. */
const GROUPS: string[][] = [
  ['da', 'nb', 'nn'],
  ['id', 'ms'],
  ['hr', 'sr', 'bs'],
  ['cs', 'sk'],
  ['ca', 'es'],
  ['nl', 'af'],
];

/** Groups whose members franc never tells apart reliably: always reported as a whole. */
const NEVER_SURE_GROUPS: string[][] = [
  ['id', 'ms'],
  ['hr', 'sr', 'bs'],
];
const NEVER_SURE = new Set(NEVER_SURE_GROUPS.flat());

const NOT_CONFIDENT: PostingLanguages = {
  codes: [],
  closeCalls: [],
  confident: false,
};

/**
 * The text's paragraphs: each line long enough to detect on its own, and each run of
 * shorter lines (headings, bullets) joined into one, so a list is judged as a whole.
 */
function paragraphs(text: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length >= MIN_PARAGRAPH) {
      flush();
      out.push(line);
    } else run.push(line);
  }
  flush();
  return out;
}

/**
 * The paragraph's sentence pieces. Sentences are split after `.`, `!` or `?` before a capital
 * (also when the text was flattened with no space), but not inside `Next.js` or `2.5`. A piece
 * under MIN_PARAGRAPH joins the next one; a short last piece joins the previous one.
 */
export function sentencePieces(paragraph: string): string[] {
  const raw = paragraph.split(
    /(?<=[.!?])\s*(?=[\p{Lu}¡¿\p{Extended_Pictographic}])/u,
  );
  const pieces: string[] = [];
  let carry = '';
  for (const part of raw) {
    carry = carry ? `${carry} ${part}` : part;
    if (carry.trim().length >= MIN_PARAGRAPH) {
      pieces.push(carry.trim());
      carry = '';
    }
  }
  if (carry.trim()) {
    if (pieces.length) pieces[pieces.length - 1] += ` ${carry.trim()}`;
    else pieces.push(carry.trim());
  }
  return pieces;
}

type Call = { sure: string } | { group: string[]; members: string[] } | null;

/** One piece's call: a sure language, a close call within a group, or null when unsure. */
function callPiece(piece: string): Call {
  const seen = new Set<string>();
  const scores: [string, number][] = [];
  for (const [iso3, score] of francAll(piece, {
    minLength: MIN_PARAGRAPH,
    only: ONLY,
  })) {
    const code = ISO_639_1[iso3];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    scores.push([code, score]);
  }
  if (scores.length === 0) return null;
  const [winner, top] = scores[0];
  const group = GROUPS.find((g) => g.includes(winner)) ?? [winner];
  const outside = scores.find(([c]) => !group.includes(c));
  if (outside && top - outside[1] < MIN_MARGIN) return null;
  if (NEVER_SURE.has(winner)) {
    return { group, members: [...group].sort() };
  }
  const near = scores
    .filter(([c, s]) => group.includes(c) && top - s < MIN_MARGIN)
    .map(([c]) => c);
  if (near.length === 1) return { sure: winner };
  return { group, members: [...near].sort() };
}

/**
 * The languages a posting is written in. Each sentence piece of each paragraph is judged on
 * its own; a language (or close call) is kept when its pieces hold at least a quarter of the
 * detected characters, so a stray English line in a French posting does not count. Not
 * confident when the text, or the part of it detected with confidence, is under 200 characters.
 */
export function detectPostingLanguages(text: string): PostingLanguages {
  if (text.trim().length < MIN_TEXT) return NOT_CONFIDENT;
  const sure = new Map<string, number>();
  const close = new Map<string, { members: Set<string>; chars: number }>();
  let detected = 0;
  for (const paragraph of paragraphs(text)) {
    for (const piece of sentencePieces(paragraph)) {
      const call = callPiece(piece);
      if (call === null) continue;
      detected += piece.length;
      if ('sure' in call) {
        sure.set(call.sure, (sure.get(call.sure) ?? 0) + piece.length);
        continue;
      }
      const key = call.group[0];
      const entry = close.get(key) ?? { members: new Set<string>(), chars: 0 };
      call.members.forEach((m) => entry.members.add(m));
      entry.chars += piece.length;
      close.set(key, entry);
    }
  }
  if (detected < MIN_TEXT) return NOT_CONFIDENT;
  const codes = [...sure]
    .filter(([, n]) => n / detected >= MIN_SHARE)
    .sort(([, a], [, b]) => b - a)
    .map(([code]) => code);
  const closeCalls = [...close.values()]
    .filter((e) => e.chars / detected >= MIN_SHARE)
    .sort((a, b) => b.chars - a.chars)
    .map((e) => [...e.members].sort());
  return { codes, closeCalls, confident: true };
}
