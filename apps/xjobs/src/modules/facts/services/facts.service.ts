import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { parseStoredDocument } from 'src/modules/processor/schema/extraction';
import { canonical } from 'src/modules/processor/rules/input';
import { FACTS_VERSION } from '../config/facts.config';
import type { PlaceVocabulary } from '../places/resolver';
import { PlaceVocabularyRepository } from '../places/place-vocabulary.repository';
import { FactsRepository } from '../repositories/facts.repository';
import { combineFacts } from '../rules/combine';
import { listingFacts } from '../rules/listing';
import type { JobFactsDocument } from '../schema/facts';

export type BuildResult =
  | {
      status: 'built';
      /** Whether the facts hash differs from the stored one (the row is saved either way). */
      changed: boolean;
      facts: JobFactsDocument;
      factsHash: string;
      extractionId: string;
    }
  | { status: 'skipped'; reason: 'no_extraction' | 'old_schema' };

/** Clock token; defaults to the current time. Tests provide their own. */
export const FACTS_CLOCK = Symbol('FACTS_CLOCK');

/** The vocabulary changes only through db:vocab, so it may be stale. */
const VOCAB_TTL_MS = 10 * 60_000;

export function hashFacts(facts: JobFactsDocument): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(facts)))
    .digest('hex');
}

@Injectable()
export class FactsService {
  private vocab: { value: PlaceVocabulary; loadedAt: number } | null = null;

  constructor(
    private readonly repo: FactsRepository,
    private readonly vocabulary: PlaceVocabularyRepository,
    @Optional()
    @Inject(FACTS_CLOCK)
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Combines the job's description and listing facts and stores them, even when nothing changed. */
  async build(jobId: string): Promise<BuildResult> {
    const inputs = await this.repo.loadInputs(jobId);
    if (!inputs) return { status: 'skipped', reason: 'no_extraction' };
    const stored = parseStoredDocument(inputs.extraction);
    if (inputs.schemaVersion !== 3 || stored?.version !== 3)
      return { status: 'skipped', reason: 'old_schema' };
    const now = this.clock();
    const vocab = await this.loadVocabulary(now.getTime());
    const { facts, conflicts } = combineFacts({
      extraction: stored.document,
      listing: listingFacts(inputs.listing, vocab),
      vocab,
      now,
    });
    const factsHash = hashFacts(facts);
    const before = await this.repo.current(jobId);
    // Saved even when unchanged: builtAt, extractionId and factsVersion must
    // move or the stale sweep would pick the job again forever.
    await this.repo.save({
      jobId,
      extractionId: inputs.extractionId,
      factsVersion: FACTS_VERSION,
      factsHash,
      facts,
      closed: facts.closed,
      conflicts,
    });
    return {
      status: 'built',
      changed: before?.factsHash !== factsHash,
      facts,
      factsHash,
      extractionId: inputs.extractionId,
    };
  }

  private async loadVocabulary(at: number): Promise<PlaceVocabulary> {
    if (this.vocab && at - this.vocab.loadedAt < VOCAB_TTL_MS)
      return this.vocab.value;
    const value = await this.vocabulary.load();
    this.vocab = { value, loadedAt: at };
    return value;
  }
}
