/**
 * Stable key of a role from its title: lower-case, accents folded, `[a-z0-9]`
 * runs joined by `-` (`role` when none); repeats get `-2`, `-3` in order, and a
 * suffixed key never equals a key already used.
 */
export function roleKeys(titles: string[]): string[] {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return titles.map((title) => {
    const base =
      title
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.join('-') || 'role';
    let n = counts.get(base) ?? 0;
    let key: string;
    do {
      n += 1;
      key = n === 1 ? base : `${base}-${n}`;
    } while (used.has(key));
    counts.set(base, n);
    used.add(key);
    return key;
  });
}
