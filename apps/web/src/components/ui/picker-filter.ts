export type PickerOption = {
  value: string;
  label: string;
  /** Aliases that also match, e.g. `['USA']` for United States. */
  keywords?: string[];
  /** A short muted tag after the label in the list, e.g. the kind of a place. Not searched. */
  detail?: string;
};

/** Lowercase and strip accents (NFD, then drop combining marks). */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Most matches a picker renders; typing narrows the rest. */
export const PICKER_LIMIT = 50;

const cache = new WeakMap<PickerOption, string[]>();

function searchTerms(option: PickerOption): string[] {
  let terms = cache.get(option);
  if (!terms) {
    terms = [option.label, ...(option.keywords ?? [])].map(normalizeSearch);
    cache.set(option, terms);
  }
  return terms;
}

/**
 * The single source of picker matching. Matches the label and keywords,
 * ignoring case and accents. Prefix matches come first, then substring
 * matches, each in the original order. Returns at most `limit` options.
 */
export function filterOptions(
  options: PickerOption[],
  query: string,
  limit = PICKER_LIMIT,
): PickerOption[] {
  const q = normalizeSearch(query);
  if (!q) return options.slice(0, limit);

  const prefix: PickerOption[] = [];
  const substring: PickerOption[] = [];
  for (const option of options) {
    const terms = searchTerms(option);
    if (terms.some((term) => term.startsWith(q))) {
      prefix.push(option);
      if (prefix.length >= limit) break;
    } else if (terms.some((term) => term.includes(q))) {
      substring.push(option);
    }
  }
  return prefix.concat(substring).slice(0, limit);
}
