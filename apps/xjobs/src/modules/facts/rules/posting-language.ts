import { francAll } from 'franc';

/** The languages a posting is written in (ISO 639-1), and whether the detector is sure of them. */
export interface PostingLanguages {
  codes: string[];
  confident: boolean;
}

/** Below this many characters (of the text, and of its detected paragraphs) nothing is sure. */
const MIN_TEXT = 200;
/** A paragraph shorter than this is not detected (franc's `minLength`). */
const MIN_PARAGRAPH = 50;
/** A language is kept when its paragraphs hold at least this share of the detected characters. */
const MIN_SHARE = 0.25;
/**
 * A paragraph counts only when the runner-up scores at least this far below the winner
 * (franc scores the winner 1). A bare list of tool names scores Portuguese and Galician
 * within 0.002 of each other; real prose leaves 0.03 or more.
 */
const MIN_MARGIN = 0.02;

/**
 * franc's ISO 639-3 codes to the ISO 639-1 codes of the `languages` vocabulary
 * (`iso_languages`), for every language franc can detect that has one. franc reports some
 * macrolanguages by a member (`arb` for Arabic, `pes` for Persian, `cmn` for Chinese).
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
  glg: 'gl', // Galician
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

const NOT_CONFIDENT: PostingLanguages = { codes: [], confident: false };

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

/** The paragraph's language (ISO 639-1) when franc is sure of it and it maps; else null. */
function detectParagraph(paragraph: string): string | null {
  const [best, next] = francAll(paragraph, {
    minLength: MIN_PARAGRAPH,
    only: ONLY,
  });
  if (!best || best[0] === 'und') return null;
  if (next && best[1] - next[1] < MIN_MARGIN) return null;
  return ISO_639_1[best[0]] ?? null;
}

/**
 * The languages a posting is written in. Each paragraph is detected on its own; a language
 * is kept when its paragraphs hold at least a quarter of the detected characters, so a
 * stray English line in a French posting does not count. Not confident when the text, or
 * the part of it detected with confidence, is under 200 characters.
 */
export function detectPostingLanguages(text: string): PostingLanguages {
  if (text.trim().length < MIN_TEXT) return NOT_CONFIDENT;
  const chars = new Map<string, number>();
  let detected = 0;
  for (const p of paragraphs(text)) {
    const code = detectParagraph(p);
    if (code === null) continue;
    chars.set(code, (chars.get(code) ?? 0) + p.length);
    detected += p.length;
  }
  if (detected < MIN_TEXT) return NOT_CONFIDENT;
  const codes = [...chars]
    .filter(([, n]) => n / detected >= MIN_SHARE)
    .sort(([, a], [, b]) => b - a)
    .map(([code]) => code);
  return { codes, confident: true };
}
