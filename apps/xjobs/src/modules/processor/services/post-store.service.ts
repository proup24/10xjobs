import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import { linkKeysOf } from 'src/modules/ingest/normalize/job-key';
import type { PostingInput } from '../models/types';
import { postPromptHash } from '../prompts/prompt';
import {
  ProcessorRepository,
  type ReuseKey,
} from '../repositories/processor.repository';
import type { Vocabulary } from '../repositories/vocab.repository';
import { inputHash } from '../rules/input';
import type { TypedColumns } from '../rules/typed-columns';
import { EXTRACTION_SCHEMA_VERSION } from '../schema';
import {
  POST_SCHEMA_VERSION,
  type PostDocument,
  postDocumentSchema,
} from '../schema/post-extraction';
import type { AttemptLog } from './attempt-log';
import { ExtractionStore } from './extraction-store.service';
import type { AssembledPost } from './post-assembler.service';

/** A post row has no listing facts of its own: its roles' rows hold them. */
const NO_COLUMNS: TypedColumns = {
  arrangement: null,
  seniority: null,
  roleKind: null,
  contractType: null,
  engagement: null,
  isSoftwareEngineeringRole: null,
  worldwide: false,
  regionCodes: [],
  countryCodes: [],
  cityIds: [],
  techTags: [],
  mainStackTags: [],
  requiredTags: [],
  niceTags: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
};

/**
 * Every write a processed post makes: its `post` row, one listing-shaped row
 * per role, and the role jobs that point at them. Role rows belong to the post
 * job (`jobId`); each role job's `currentExtractionId` is its row.
 *
 * Not one transaction, like ExtractionStore: the role rows are written before
 * the post row, so a post row (what exact reuse finds) always has its role
 * rows, and a run cut short after the rows is healed by the next run's exact
 * reuse, which syncs the role jobs.
 */
@Injectable()
export class PostStore {
  private readonly logger = new Logger(PostStore.name);

  constructor(
    private readonly repo: ProcessorRepository,
    private readonly extractions: ExtractionStore,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
  ) {}

  /**
   * Same post input, post schema, post prompt, listing schema and model:
   * same post document. See postKeyPromptHash for the listing schema.
   */
  reuseKey(input: PostingInput): ReuseKey {
    return {
      docType: 'post',
      inputHash: inputHash(input),
      schemaVersion: POST_SCHEMA_VERSION,
      promptHash: postKeyPromptHash(),
      extractionModel: this.config.extractionModel,
    };
  }

  /**
   * An earlier post row for this exact key, linked to the job (copied when
   * it was another job's), with the role jobs synced to it. Never the joined
   * reuse: a share's added text must be read. A row that no longer reads (its
   * document fails to parse, or a role row is missing) is not reused: null,
   * so the caller runs afresh, and nothing is copied or changed.
   */
  async reuse(key: ReuseKey, postJobId: string): Promise<string | null> {
    const found = await this.repo.findReusable(key);
    if (!found) return null;
    const stored = await this.readReusable(found.id);
    if (!stored) return null;
    const id =
      found.jobId === postJobId
        ? found.id
        : await this.repo.copyExtraction(found.id, postJobId);
    await this.linkRoles(postJobId, stored);
    return id;
  }

  /**
   * Saves the post's role rows, then its `post` row, then makes the role
   * jobs match the document (a kept role keeps its job, a gone one is
   * archived), then records the run's attempts once, on the post row.
   */
  async save(
    postJobId: string,
    key: ReuseKey,
    assembled: AssembledPost,
    _vocabulary: Vocabulary,
    log: AttemptLog,
  ): Promise<string> {
    const { doc } = assembled;
    const roleRows: string[] = [];
    for (const [i, role] of doc.roles.entries())
      roleRows.push(
        await this.extractions.saveDocument(
          postJobId,
          roleKey(key, role.roleKey),
          assembled.roles[i],
          // The run's cost is on the post row; the role rows cost nothing more.
          0,
        ),
      );
    const extractionId = await this.repo.saveExtraction({
      ...key,
      ...NO_COLUMNS,
      jobId: postJobId,
      data: doc,
      needsReview: doc.verdict.confidence === 'unsure',
      costUsd: log.costUsd,
      verdict: doc.verdict.value,
      verdictReason: doc.verdict.reason,
      verdictConfidence: doc.verdict.confidence,
    });
    await this.writeRoleJobs(postJobId, doc, roleRows);
    await this.repo.recordAttempts(log.entries(extractionId));
    return extractionId;
  }

  /**
   * Makes the post's role jobs match a stored post row: each role's row
   * (copied to this post job when it is another's), the role jobs upserted,
   * the others archived. False, changing nothing, when the row doesn't read.
   */
  async syncRoles(
    postJobId: string,
    postExtractionId: string,
  ): Promise<boolean> {
    const stored = await this.readReusable(postExtractionId);
    if (!stored) return false;
    await this.linkRoles(postJobId, stored);
    return true;
  }

  /** A stored post row's document and its role rows; null, with a warning, when either is gone or unreadable. */
  private async readReusable(
    postExtractionId: string,
  ): Promise<StoredPost | null> {
    const row = await this.repo.findExtraction(postExtractionId);
    if (!row) {
      this.logger.warn(
        `post extraction ${postExtractionId} not found; not reused, extracting afresh`,
      );
      return null;
    }
    const parsed = postDocumentSchema.safeParse(row.data);
    if (!parsed.success) {
      this.logger.warn(
        `post extraction ${postExtractionId} does not read as a post document (${parsed.error.issues[0]?.message ?? 'invalid'}); not reused, extracting afresh`,
      );
      return null;
    }
    const roles: { id: string; jobId: string }[] = [];
    for (const role of parsed.data.roles) {
      const found = await this.repo.findReusable(roleKey(row, role.roleKey));
      if (!found) {
        this.logger.warn(
          `post extraction ${postExtractionId}: role ${role.roleKey} has no extraction; not reused, extracting afresh`,
        );
        return null;
      }
      roles.push(found);
    }
    return { doc: parsed.data, roles };
  }

  private async linkRoles(
    postJobId: string,
    stored: StoredPost,
  ): Promise<void> {
    const roleRows: string[] = [];
    for (const found of stored.roles)
      roleRows.push(
        found.jobId === postJobId
          ? found.id
          : await this.repo.copyExtraction(found.id, postJobId),
      );
    await this.writeRoleJobs(postJobId, stored.doc, roleRows);
  }

  private async writeRoleJobs(
    postJobId: string,
    doc: PostDocument,
    roleRows: string[],
  ): Promise<void> {
    for (const [i, role] of doc.roles.entries())
      await this.repo.upsertRoleJob({
        postJobId,
        roleKey: role.roleKey,
        title: role.title,
        companyName: role.employer.name,
        extractionId: roleRows[i],
        linkKeys: linkKeysOf(role.howToApply.links),
      });
    await this.repo.archiveRoleJobs(
      postJobId,
      doc.roles.map((r) => r.roleKey),
    );
  }
}

interface StoredPost {
  doc: PostDocument;
  roles: { id: string; jobId: string }[];
}

/**
 * The post key's prompt part: the post prompt hash and the listing schema
 * version the roles' facts are read with. A post document embeds listing
 * documents, so a listing schema bump (EXTRACTION_SCHEMA_VERSION) must move
 * the post key, even when no prompt text changes. Folded into the prompt hash
 * rather than the schema version, so a post row's schemaVersion stays the post
 * document's own version (POST_SCHEMA_VERSION), the one its data reads as.
 * Listing keys and role row keys are untouched: a role row's schemaVersion
 * already is EXTRACTION_SCHEMA_VERSION.
 */
export function postKeyPromptHash(
  listingSchemaVersion: number = EXTRACTION_SCHEMA_VERSION,
): string {
  return createHash('sha256')
    .update(`${postPromptHash()}\nlisting schema v${listingSchemaVersion}`)
    .digest('hex');
}

/** The key of a role's listing row: the post's input and model, the listing schema, the post prompt. */
function roleKey(
  post: Pick<ReuseKey, 'inputHash' | 'extractionModel'>,
  key: string,
): ReuseKey {
  return {
    docType: 'listing',
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    promptHash: postPromptHash(),
    inputHash: createHash('sha256')
      .update(`${post.inputHash}:${key}`)
      .digest('hex'),
    extractionModel: post.extractionModel,
  };
}
