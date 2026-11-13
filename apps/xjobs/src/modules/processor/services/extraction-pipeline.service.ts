import { Injectable } from '@nestjs/common';
import type { PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { checkConsistency } from '../rules/validate';
import type { AttemptLog } from './attempt-log';
import type { AssembledDocument } from './fact-assembler.service';
import { GenerationService } from './generation.service';

/** The generation never produced a valid document: the job fails with these errors. */
export class ExtractionFailed extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'ExtractionFailed';
  }
}

/**
 * A posting in, a document out:
 *
 *   1. GenerationService   the generator writes the whole document; the assembler checks it
 *   2. checkConsistency    the cross-fact rules on the result
 *
 * Writes nothing: the caller decides whether to save.
 */
@Injectable()
export class ExtractionPipeline {
  constructor(private readonly generation: GenerationService) {}

  async run(
    input: PostingInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<AssembledDocument> {
    const result = await this.generation.generate(input, vocabulary, log);
    if (!result.ok) {
      log.warn('the generation never produced a valid document');
      throw new ExtractionFailed(result.errors);
    }
    const { assembled } = result;
    const doc = checkConsistency(
      assembled.doc,
      vocabulary.engineeringRoleKinds,
    );
    return { ...assembled, doc };
  }
}
