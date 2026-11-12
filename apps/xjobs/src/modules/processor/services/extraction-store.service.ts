import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import type { PostingInput } from '../models/types';
import { promptHash } from '../prompts/prompt';
import {
  ProcessorRepository,
  type ReuseKey,
} from '../repositories/processor.repository';
import {
  cityKey,
  VocabRepository,
  type Vocabulary,
} from '../repositories/vocab.repository';
import { inputHash } from '../rules/input';
import { buildVerificationQuestions } from '../rules/questions';
import { deriveTypedColumns } from '../rules/typed-columns';
import { needsReview } from '../rules/validate';
import { EXTRACTION_SCHEMA_VERSION, type ExtractionDocument } from '../schema';
import type { ListName } from '../vocab/lists';
import type { AttemptLog } from './attempt-log';
import type { AssembledDocument } from './fact-assembler.service';

/** Every write a processed job makes, and the reuse of an earlier extraction. */
@Injectable()
export class ExtractionStore {
  constructor(
    private readonly repo: ProcessorRepository,
    private readonly vocab: VocabRepository,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /** Same input, schema, prompt and configured models: same extraction. */
  reuseKey(input: PostingInput, vocabulary: Vocabulary): ReuseKey {
    return {
      inputHash: inputHash(input),
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptHash: promptHash(buildVerificationQuestions(vocabulary.options)),
      decisionModel: this.config.decisionModel,
      extractionModel: this.config.extractionModel,
    };
  }

  /** An earlier extraction for this key, linked to the job (copied when it was another job's). */
  async reuse(key: ReuseKey, jobId: string): Promise<string | null> {
    const found = await this.repo.findReusable(key);
    if (!found) return null;
    return found.jobId === jobId
      ? found.id
      : this.repo.copyExtraction(found.id, jobId);
  }

  /**
   * Writes the extraction and everything it adds, in order: its cities (whose
   * ids go into the document), its proposed terms, the extraction row with
   * its typed columns, its attempts, and the usage counts of its codes.
   */
  async save(
    jobId: string,
    key: ReuseKey,
    assembled: AssembledDocument,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<string> {
    const doc = await this.withCityIds(assembled);
    await this.vocab.propose(assembled.proposals);
    const extractionId = await this.repo.saveExtraction({
      ...key,
      ...deriveTypedColumns(doc),
      jobId,
      data: doc,
      needsReview: needsReview(doc),
      costUsd: log.costUsd,
    });
    await this.repo.recordAttempts(log.entries(extractionId));
    for (const [list, codes] of usedCodes(doc))
      await this.vocab.bumpOccurrences(list, codes);
    return extractionId;
  }

  /** The attempts of a run that saved nothing (failed, retried, provider down). */
  async recordAttempts(log: AttemptLog): Promise<void> {
    await this.repo.recordAttempts(log.entries());
  }

  private async withCityIds({
    doc,
    cities,
  }: AssembledDocument): Promise<ExtractionDocument> {
    const ids = await this.vocab.upsertCities(cities);
    for (const opening of doc.openings)
      for (const place of opening.places)
        if (place.kind === 'city' && place.countryCode !== null)
          place.cityId =
            ids.get(
              cityKey({ name: place.name, countryCode: place.countryCode }),
            ) ?? null;
    return doc;
  }
}

/** Every approved code the document uses, per list; repeats count each time. */
function usedCodes(doc: ExtractionDocument): [ListName, string[]][] {
  const used: Record<string, string[]> = {};
  const add = (list: ListName, code: string | null | undefined) => {
    if (code) (used[list] ??= []).push(code);
  };
  add('seniorities', doc.seniority.value);
  add('arrangements', doc.arrangement.value);
  add('roleKinds', doc.position.value?.roleKind);
  add('contractTypes', doc.contractType.value);
  add('engagements', doc.engagement.value);
  for (const f of doc.junkFlags.value ?? []) add('junkFlags', f.code);
  for (const o of doc.openings) {
    for (const a of o.arrangements) add('arrangements', a);
    for (const p of o.places) {
      if (p.kind === 'region') add('regions', p.code);
      else if (p.kind === 'country') add('countries', p.code);
      else if (p.kind === 'city') add('countries', p.countryCode);
    }
  }
  for (const r of doc.techStack.value?.requirements ?? [])
    add('techTags', r.technology.code);
  return Object.entries(used) as [ListName, string[]][];
}
