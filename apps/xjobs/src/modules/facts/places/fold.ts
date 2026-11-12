/** Fold a place name for matching: no accents, lower case, hyphens and runs of spaces become one space. */
export function foldPlaceName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .trim();
}
