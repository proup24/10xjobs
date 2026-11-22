/** Stable key of a role from its title: lower-case, accents folded, `[a-z0-9]` runs joined by `-`; repeats get `-2`, `-3` in order. */
export function roleKeys(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base =
      title
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.join('-') ?? '';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}
