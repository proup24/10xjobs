import { Injectable } from '@nestjs/common';
import { postSystemPrompt } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import type { PostInput } from '../rules/post-input';
import { checkConsistency } from '../rules/validate';
import {
  type PostModelOutput,
  postModelOutputSchema,
} from '../schema/post-extraction';
import type { AttemptLog } from './attempt-log';
import { ExtractionFailed } from './extraction-pipeline.service';
import { type GenerationSpec, GenerationService } from './generation.service';
import { type AssembledPost, PostAssembler } from './post-assembler.service';

/**
 * A post in, a post document out, as ExtractionPipeline does for a listing:
 *
 *   1. GenerationService   the generator writes the post document; PostAssembler checks it
 *   2. checkConsistency    the cross-fact rules on each role's facts
 *
 * Writes nothing: the caller decides whether to save.
 */
@Injectable()
export class PostPipeline {
  constructor(
    private readonly generation: GenerationService,
    private readonly assembler: PostAssembler,
  ) {}

  async run(
    post: PostInput,
    vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<AssembledPost> {
    const result = await this.generation.generateWith(
      this.spec(post),
      post.input,
      vocabulary,
      log,
    );
    if (!result.ok) {
      log.warn('the generation never produced a valid document');
      throw new ExtractionFailed(result.errors);
    }
    const { assembled } = result;
    const kinds = vocabulary.engineeringRoleKinds;
    return {
      ...assembled,
      doc: {
        ...assembled.doc,
        roles: assembled.doc.roles.map((role) => ({
          ...role,
          facts: checkConsistency(role.facts, kinds),
        })),
      },
      roles: assembled.roles.map((role) => ({
        ...role,
        doc: checkConsistency(role.doc, kinds),
      })),
    };
  }

  /** Built per post: the assembler checks quotes against its text and links. */
  private spec(post: PostInput): GenerationSpec<AssembledPost> {
    return {
      systemPrompt: postSystemPrompt,
      schema: (v) => postModelOutputSchema(v.options),
      assemble: (parsed, meta, input, v) =>
        this.assembler.assemble(
          parsed as PostModelOutput,
          meta,
          input,
          post.postText,
          post.links,
          v,
        ),
      describe: ({ doc, quoteFailures }) => [
        `post assembled: ${doc.verdict.value} (${doc.verdict.reason}), ${doc.roles.length} roles, ${quoteFailures} unsupported quotes cleared`,
      ],
    };
  }
}
