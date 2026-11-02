import type { ListOptions } from '../schema';
import { LIST_NAMES } from '../vocab/lists';
import { SEED } from '../vocab/seed-data';

/** Every seeded code as an approved option. */
export function seedOptions(): ListOptions {
  return Object.fromEntries(
    LIST_NAMES.map((n) => [n, SEED[n].map((t) => t.code)]),
  ) as ListOptions;
}
