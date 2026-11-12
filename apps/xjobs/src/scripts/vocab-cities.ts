import type { FactsRepository } from 'src/modules/facts/repositories/facts.repository';
import type { VocabRepository } from 'src/modules/processor/repositories/vocab.repository';

/** A change `db:vocab cities` makes to one city. */
export type CityChange =
  | { action: 'approve' | 'reject'; code: string }
  | { action: 'alias'; code: string; spelling: string };

export interface CityChangeDeps {
  vocab: Pick<VocabRepository, 'approveCity' | 'rejectCity' | 'aliasCity'>;
  facts: Pick<FactsRepository, 'markStale'>;
  /** The city's country, or null when there is no such city. */
  cityCountry(id: string): Promise<string | null>;
}

/**
 * Approves, rejects or aliases a city. A change can move the places of jobs in its country,
 * so their facts are then marked stale: the sweep builds them again and re-decides the jobs
 * whose facts changed. The country is read first, since a reject deletes the city.
 */
export async function changeCity(
  change: CityChange,
  deps: CityChangeDeps,
): Promise<{ changed: boolean; staleFacts: number }> {
  const country = await deps.cityCountry(change.code);
  const changed =
    change.action === 'alias'
      ? await deps.vocab.aliasCity(change.code, change.spelling)
      : change.action === 'approve'
        ? await deps.vocab.approveCity(change.code)
        : await deps.vocab.rejectCity(change.code);
  if (!changed || country === null) return { changed, staleFacts: 0 };
  return {
    changed,
    staleFacts: await deps.facts.markStale({ countryCode: country }),
  };
}
