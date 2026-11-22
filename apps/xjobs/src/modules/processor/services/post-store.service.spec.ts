import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import { postPromptHash } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import { EXTRACTION_SCHEMA_VERSION } from '../schema';
import {
  fixtureHiringPost,
  fixtureJunkPost,
} from '../schema/fixture-post.testing';
import { POST_SCHEMA_VERSION } from '../schema/post-extraction';
import type { PostDocument } from '../schema/post-extraction';
import {
  fakeMeta,
  MemoryProcessorRepository,
  MemoryVocabRepository,
} from '../testing/fakes';
import { AttemptLog } from './attempt-log';
import { ExtractionStore } from './extraction-store.service';
import type { AssembledPost } from './post-assembler.service';
import { PostStore } from './post-store.service';

const EXT = 'anthropic/claude-opus-5.5';
const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
  postDailyCap: 250,
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** An assembled post for a document: each role's listing assembly is its facts. */
const assembledOf = (doc: PostDocument): AssembledPost => ({
  doc,
  roles: doc.roles.map((r) => ({
    doc: structuredClone(r.facts),
    cities: [],
    proposals: [],
    quoteFailures: 0,
    mergedDuplicates: [],
  })),
  quoteFailures: 0,
});

describe('PostStore', () => {
  let repo: MemoryProcessorRepository;
  let vocab: MemoryVocabRepository;
  let vocabulary: Vocabulary;
  let store: PostStore;
  let log: AttemptLog;

  const roleJobs = (postId = 'post-1') =>
    [...repo.jobs.values()].filter((j) => j.parentJobId === postId);
  const row = (id: string | null) => {
    const found = repo.extractions.find((e) => e.id === id);
    if (!found) throw new Error(`no extraction ${id}`);
    return found;
  };

  beforeEach(async () => {
    repo = new MemoryProcessorRepository();
    vocab = new MemoryVocabRepository();
    vocabulary = await vocab.snapshot();
    store = new PostStore(
      repo,
      new ExtractionStore(repo, vocab, config),
      config,
    );
    log = new AttemptLog('post-1', { docType: 'post' });
    log.ok('generation', EXT, fakeMeta(EXT, { costUsd: 0.05 }));
    repo.addJob({ id: 'post-1', kind: 'post', linkedIn: false });
  });

  it('reuseKey: the post schema, the post prompt and the model', () => {
    const key = store.reuseKey({
      jobId: 'post-1',
      title: null,
      description: 'text',
      truncated: false,
    });
    expect(key).toMatchObject({
      docType: 'post',
      schemaVersion: POST_SCHEMA_VERSION,
      promptHash: postPromptHash(),
      extractionModel: EXT,
    });
    expect(key.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('save: the post row, one listing row per role, the role jobs, and the attempts once', async () => {
    const key = store.reuseKey({
      jobId: 'post-1',
      title: null,
      description: 'text',
      truncated: false,
    });
    const id = await store.save(
      'post-1',
      key,
      assembledOf(fixtureHiringPost()),
      vocabulary,
      log,
    );

    const post = row(id);
    expect(post).toMatchObject({
      ...key,
      jobId: 'post-1',
      verdict: 'hiring',
      verdictReason: 'hiring',
      verdictConfidence: 'sure',
      needsReview: false,
      costUsd: 0.05,
      arrangement: null,
      isSoftwareEngineeringRole: null,
      worldwide: false,
      regionCodes: [],
      salaryMin: null,
    });
    const roles = roleJobs();
    expect(roles.map((r) => [r.roleKey, r.title, r.companyName])).toEqual([
      ['backend-engineer', 'Backend Engineer', 'Acme'],
      ['senior-backend-engineer', 'Senior Backend Engineer', 'Acme'],
    ]);
    for (const r of roles)
      expect(row(r.currentExtractionId)).toMatchObject({
        jobId: 'post-1',
        docType: 'listing',
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        promptHash: postPromptHash(),
        extractionModel: EXT,
        inputHash: sha(`${key.inputHash}:${r.roleKey}`),
        costUsd: 0,
        verdict: null,
      });
    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0]).toMatchObject({
      extractionId: id,
      docType: 'post',
    });
  });

  it('save: a junk post makes no role rows and archives the role jobs', async () => {
    const key = store.reuseKey({
      jobId: 'post-1',
      title: null,
      description: 'a',
      truncated: false,
    });
    await store.save(
      'post-1',
      key,
      assembledOf(fixtureHiringPost()),
      vocabulary,
      log,
    );
    const junkKey = { ...key, inputHash: 'other' };
    await store.save(
      'post-1',
      junkKey,
      assembledOf(fixtureJunkPost()),
      vocabulary,
      new AttemptLog('post-1', { docType: 'post' }),
    );
    expect(roleJobs().map((r) => r.processingStatus)).toEqual([
      'archived',
      'archived',
    ]);
    expect(
      repo.extractions.filter((e) => e.docType === 'listing'),
    ).toHaveLength(2);
  });

  it('syncRoles: brings archived role jobs back to the reused document', async () => {
    const key = store.reuseKey({
      jobId: 'post-1',
      title: null,
      description: 'a',
      truncated: false,
    });
    const id = await store.save(
      'post-1',
      key,
      assembledOf(fixtureHiringPost()),
      vocabulary,
      log,
    );
    const before = new Map(
      roleJobs().map((r) => [r.id, r.currentExtractionId]),
    );
    await repo.archiveRoleJobs('post-1', []);

    await store.syncRoles('post-1', id);

    for (const r of roleJobs()) {
      expect(r.processingStatus).toBe('processed');
      expect(r.currentExtractionId).toBe(before.get(r.id));
    }
  });

  it('syncRoles: a missing role row is an error, not a silent drop', async () => {
    const key = store.reuseKey({
      jobId: 'post-1',
      title: null,
      description: 'a',
      truncated: false,
    });
    const id = await store.save(
      'post-1',
      key,
      assembledOf(fixtureHiringPost()),
      vocabulary,
      log,
    );
    repo.extractions.splice(
      repo.extractions.findIndex((e) => e.docType === 'listing'),
      1,
    );
    await expect(store.syncRoles('post-1', id)).rejects.toThrow(
      /role backend-engineer/,
    );
  });
});
