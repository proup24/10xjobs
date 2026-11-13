/**
 * In-memory stand-ins for the processor's models and repositories. They follow
 * the abstract contracts closely enough for unit tests and the golden-set eval.
 */
import { cityForms, placeCityKey } from 'src/modules/facts/places/city-forms';
import { foldPlaceName } from 'src/modules/facts/places/fold';
import { randomUUID } from 'node:crypto';
import type { ListTableRow } from '@xjobs/database';
import { ModelOutputError } from '../models/errors';
import type {
  DecisionAnswer,
  DecisionQuestion,
  GenerateRequest,
  JobForProcessing,
  ModelCallMeta,
  PostingInput,
} from '../models/types';
import { DecisionModel, ExtractionModel } from '../models/types';
import {
  type Claim,
  type FinishOutcome,
  type JobState,
  type NewAttempt,
  type NewExtraction,
  type ProcessingCounts,
  ProcessorRepository,
  readStoredData,
  type ReprocessFilter,
  type ReuseKey,
} from '../repositories/processor.repository';
import {
  matchingForms,
  VocabRepository,
  type ProposedCity,
  type ProposedTerm,
  type Vocabulary,
  addsAlias,
} from '../repositories/vocab.repository';
import type { ListOptions } from '../schema';
import { zodErrors } from '../schema/errors';
import { LIST_NAMES, type ListName } from '../vocab/lists';
import { slugCode, type VocabSnapshot } from '../vocab/resolve';
import {
  ENGINEERING_ROLE_KINDS,
  SEED,
  SEED_REGION_COUNTRIES,
  type SeedTerm,
} from '../vocab/seed-data';

export const fakeMeta = (
  model: string,
  p: Partial<ModelCallMeta> = {},
): ModelCallMeta => ({
  model,
  providerRequestId: 'req-1',
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  costUsd: 0.01,
  latencyMs: 10,
  ...p,
});

/** Returns each item in turn (the last one repeats); an `Error` item is thrown. */
export function sequence<T>(...items: (T | Error)[]): () => T {
  let i = 0;
  return () => {
    const item = items[Math.min(i++, items.length - 1)];
    if (item instanceof Error) throw item;
    return item;
  };
}

type DecisionResponder = (
  input: PostingInput,
  questions: DecisionQuestion[],
) => DecisionAnswer[] | Promise<DecisionAnswer[]>;

export class FakeDecisionModel extends DecisionModel {
  readonly calls: { input: PostingInput; questions: DecisionQuestion[] }[] = [];

  constructor(
    private readonly respond: DecisionResponder,
    private readonly model = 'typesafe/jev-1.14',
    private readonly meta: Partial<ModelCallMeta> = {},
  ) {
    super();
  }

  async decide(
    input: PostingInput,
    questions: DecisionQuestion[],
  ): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta }> {
    this.calls.push({ input, questions });
    const answers = await this.respond(input, questions);
    return { answers, meta: fakeMeta(this.model, this.meta) };
  }
}

type ExtractionResponder = (
  input: PostingInput,
  req: GenerateRequest,
) => unknown;

/**
 * The generator, faked: answers with `respond`, and like the real one throws
 * `ModelOutputError` (listing the issues) when the answer does not match
 * `req.schema`. A thrown error is rethrown.
 */
export class FakeExtractionModel extends ExtractionModel {
  readonly calls: { input: PostingInput; req: GenerateRequest }[] = [];

  constructor(
    private readonly respond: ExtractionResponder,
    private readonly model = 'anthropic/claude-opus-5.5',
    private readonly meta: Partial<ModelCallMeta> = {},
  ) {
    super();
  }

  async generate(
    input: PostingInput,
    req: GenerateRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }> {
    this.calls.push({ input, req });
    const output = await this.respond(input, req);
    const meta = fakeMeta(this.model, this.meta);
    const parsed = req.schema.safeParse(output);
    if (!parsed.success)
      throw new ModelOutputError(
        `Extraction did not match the schema: ${zodErrors(parsed.error).join('; ')}`,
        meta,
      );
    return { output: parsed.data, meta };
  }
}

export interface MemoryJob extends JobForProcessing {
  /** Shown by `jobState` only; the processor never reads it. */
  companyName: string | null;
  status: 'active' | 'merged';
  kind: 'job' | 'post';
  /** Has a LinkedIn job board source. */
  linkedIn: boolean;
  processingStatus: 'pending' | 'processing' | 'processed' | 'failed' | null;
  processingRequestedAt: Date | null;
  processingStartedAt: Date | null;
  processingAttempts: number;
  processingError: string | null;
  processedAt: Date | null;
  currentExtractionId: string | null;
}

export interface MemoryExtraction extends NewExtraction {
  id: string;
  createdAt: Date;
}

export interface MemoryAttempt extends NewAttempt {
  id: string;
  createdAt: Date;
}

export class MemoryProcessorRepository extends ProcessorRepository {
  readonly jobs = new Map<string, MemoryJob>();
  readonly extractions: MemoryExtraction[] = [];
  readonly attempts: MemoryAttempt[] = [];
  /** Every method call, by name, in order. */
  readonly log: string[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {
    super();
  }

  /** Adds an in-scope `pending` job; `p` overrides any field. */
  addJob(p: Partial<MemoryJob> & { id: string }): MemoryJob {
    const job: MemoryJob = {
      closed: false,
      title: 'Backend Engineer',
      companyName: 'Acme',
      descriptionText: 'We hire.',
      status: 'active',
      kind: 'job',
      linkedIn: true,
      processingStatus: 'pending',
      processingRequestedAt: this.now(),
      processingStartedAt: null,
      processingAttempts: 0,
      processingError: null,
      processedAt: null,
      currentExtractionId: null,
      ...p,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  /** What ingest does on a reopen: back to `pending` with a new request time. */
  reopen(jobId: string): void {
    const job = this.mustGet(jobId);
    job.processingStatus = 'pending';
    job.processingRequestedAt = new Date(
      (job.processingRequestedAt?.getTime() ?? this.now().getTime()) + 1,
    );
    job.processingAttempts = 0;
    job.processingError = null;
    job.processingStartedAt = null;
  }

  /** Logs a non-eval attempt costing `costUsd` at `at`. */
  addSpend(costUsd: number, at: Date = this.now()): void {
    this.attempts.push({
      ...attemptDefaults(),
      costUsd,
      id: randomUUID(),
      createdAt: at,
    });
  }

  private mustGet(jobId: string): MemoryJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    return job;
  }

  private inScope(job: MemoryJob): boolean {
    return job.status === 'active' && job.kind === 'job' && job.linkedIn;
  }

  async listPendingInScope(limit: number): Promise<string[]> {
    this.log.push('listPendingInScope');
    return [...this.jobs.values()]
      .filter((j) => this.inScope(j) && j.processingStatus === 'pending')
      .sort(
        (a, b) =>
          (a.processingRequestedAt?.getTime() ?? -Infinity) -
            (b.processingRequestedAt?.getTime() ?? -Infinity) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, limit)
      .map((j) => j.id);
  }

  async claim(jobId: string): Promise<Claim | null> {
    this.log.push('claim');
    const job = this.jobs.get(jobId);
    if (!job || !this.inScope(job) || job.processingStatus !== 'pending')
      return null;
    job.processingStatus = 'processing';
    job.processingAttempts += 1;
    job.processingStartedAt = this.now();
    job.processingRequestedAt ??= this.now();
    return {
      jobId,
      requestedAt: job.processingRequestedAt,
      attempts: job.processingAttempts,
    };
  }

  async loadJob(jobId: string): Promise<JobForProcessing | null> {
    this.log.push('loadJob');
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      closed: job.closed,
      title: job.title,
      descriptionText: job.descriptionText,
    };
  }

  async findReusable(
    key: ReuseKey,
  ): Promise<{ id: string; jobId: string } | null> {
    this.log.push('findReusable');
    const hits = this.extractions.filter(
      (e) =>
        e.inputHash === key.inputHash &&
        e.schemaVersion === key.schemaVersion &&
        e.promptHash === key.promptHash &&
        e.decisionModel === key.decisionModel &&
        e.extractionModel === key.extractionModel,
    );
    const latest = hits.at(-1);
    return latest ? { id: latest.id, jobId: latest.jobId } : null;
  }

  async copyExtraction(extractionId: string, jobId: string): Promise<string> {
    this.log.push('copyExtraction');
    const source = this.extractions.find((e) => e.id === extractionId);
    if (!source) throw new Error(`job extraction ${extractionId} not found`);
    const copy: MemoryExtraction = {
      ...structuredClone(source),
      id: randomUUID(),
      createdAt: this.now(),
      jobId,
      costUsd: 0,
    };
    this.extractions.push(copy);
    return copy.id;
  }

  async saveExtraction(row: NewExtraction): Promise<string> {
    this.log.push('saveExtraction');
    const id = randomUUID();
    this.extractions.push({
      ...structuredClone(row),
      id,
      createdAt: this.now(),
    });
    return id;
  }

  async recordAttempts(rows: NewAttempt[]): Promise<void> {
    this.log.push('recordAttempts');
    for (const row of rows)
      this.attempts.push({
        ...structuredClone(row),
        id: randomUUID(),
        createdAt: this.now(),
      });
  }

  async finish(
    claim: Claim,
    outcome: FinishOutcome,
  ): Promise<'finished' | 'superseded'> {
    this.log.push('finish');
    const job = this.mustGet(claim.jobId);
    const held =
      job.processingStatus === 'processing' &&
      job.processingRequestedAt?.getTime() === claim.requestedAt.getTime() &&
      job.processingAttempts === claim.attempts;
    if (held) {
      job.processingStartedAt = null;
      if (outcome.status === 'processed') {
        job.processingStatus = 'processed';
        job.processingError = null;
        job.processedAt = this.now();
        if (outcome.extractionId !== null)
          job.currentExtractionId = outcome.extractionId;
      } else {
        job.processingStatus = outcome.status;
        job.processingError = outcome.error;
        if (outcome.status === 'pending' && outcome.refundAttempt)
          job.processingAttempts -= 1;
      }
      return 'finished';
    }
    if (
      outcome.status === 'processed' &&
      outcome.extractionId !== null &&
      job.processingStatus !== 'processed'
    )
      job.currentExtractionId = outcome.extractionId;
    return 'superseded';
  }

  async releaseStale(olderThan: Date): Promise<number> {
    this.log.push('releaseStale');
    let n = 0;
    for (const job of this.jobs.values()) {
      if (
        job.processingStatus === 'processing' &&
        job.processingStartedAt !== null &&
        job.processingStartedAt < olderThan
      ) {
        job.processingStatus = 'pending';
        job.processingStartedAt = null;
        n++;
      }
    }
    return n;
  }

  async spendSince(since: Date): Promise<number> {
    this.log.push('spendSince');
    return this.attempts
      .filter((a) => !a.eval && a.createdAt >= since)
      .reduce((sum, a) => sum + a.costUsd, 0);
  }

  async markPending(filter: ReprocessFilter): Promise<number> {
    this.log.push('markPending');
    const ids = new Set(filter.jobIds ?? []);
    let n = 0;
    for (const job of this.jobs.values()) {
      if (!this.inScope(job)) continue;
      const match =
        filter.allInScope ||
        (filter.nullStatus && job.processingStatus === null) ||
        (filter.failed && job.processingStatus === 'failed') ||
        ids.has(job.id);
      if (!match) continue;
      job.processingStatus = 'pending';
      job.processingRequestedAt = this.now();
      job.processingAttempts = 0;
      job.processingError = null;
      job.processingStartedAt = null;
      n++;
    }
    return n;
  }

  async jobState(jobId: string): Promise<JobState | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const extraction = this.extractions.find(
      (e) => e.id === job.currentExtractionId,
    );
    return {
      id: job.id,
      inScope: this.inScope(job),
      status: job.status,
      kind: job.kind,
      closed: job.closed,
      title: job.title,
      companyName: job.companyName,
      processingStatus: job.processingStatus,
      processingReason: null,
      processingRequestedAt: job.processingRequestedAt,
      processingAttempts: job.processingAttempts,
      processingError: job.processingError,
      processedAt: job.processedAt,
      extraction: extraction
        ? {
            id: extraction.id,
            createdAt: extraction.createdAt,
            needsReview: extraction.needsReview,
            costUsd: extraction.costUsd,
            ...readStoredData(extraction.data),
          }
        : null,
    };
  }

  async processingCounts(): Promise<ProcessingCounts> {
    const counts: ProcessingCounts = {
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      archived: 0,
      unset: 0,
    };
    for (const job of this.jobs.values())
      if (this.inScope(job)) counts[job.processingStatus ?? 'unset'] += 1;
    return counts;
  }
}

function attemptDefaults(): NewAttempt {
  return {
    jobId: null,
    extractionId: null,
    eval: false,
    step: 'generation',
    outcome: 'ok',
    error: null,
    quoteFailures: 0,
    model: 'm',
    providerRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  };
}

export interface MemoryCity {
  id: string;
  name: string;
  countryCode: string;
  aliases?: string[];
  status: 'approved' | 'proposed';
  occurrences: number;
  /** Defaults to the row's position, so earlier rows are older. */
  firstSeenAt?: Date;
}

/** The list tables in memory, seeded as approved from `SEED` by default. */
export class MemoryVocabRepository extends VocabRepository {
  readonly lists: Record<ListName, ListTableRow[]>;
  readonly cities: MemoryCity[] = [];
  /** City ids an extraction names; a proposed city in it cannot be rejected. */
  readonly citiesInUse = new Set<string>();
  readonly regionCountries: Map<string, string[]>;
  /** Role kinds marked `isEngineering`; the snapshot keeps the approved ones. */
  readonly engineeringRoleKinds = new Set<string>(ENGINEERING_ROLE_KINDS);

  constructor(
    seed: Record<ListName, SeedTerm[]> = SEED,
    regionCountries: [string, string][] = SEED_REGION_COUNTRIES,
  ) {
    super();
    this.lists = Object.fromEntries(
      LIST_NAMES.map((list) => [
        list,
        seed[list].map((t) => ({
          code: t.code,
          label: t.label,
          aliases: [...t.aliases],
          status: 'approved',
          occurrences: 0,
        })),
      ]),
    ) as Record<ListName, ListTableRow[]>;
    this.regionCountries = new Map();
    for (const [region, country] of regionCountries) {
      const list = this.regionCountries.get(region) ?? [];
      list.push(country);
      this.regionCountries.set(region, list);
    }
    for (const list of this.regionCountries.values()) list.sort();
  }

  row(list: ListName, code: string): ListTableRow | undefined {
    return this.lists[list].find((r) => r.code === code);
  }

  async snapshot(): Promise<Vocabulary> {
    const options = {} as ListOptions;
    const approved = {} as VocabSnapshot['approved'];
    for (const list of LIST_NAMES) {
      const rows = this.lists[list].filter((r) => r.status === 'approved');
      options[list] = rows.map((r) => r.code).sort();
      approved[list] = matchingForms(rows);
    }
    const regionCountries = new Map(
      [...this.regionCountries].map(([k, v]) => [k, [...v]]),
    );
    const engineeringRoleKinds = new Set(
      this.lists.roleKinds
        .filter(
          (r) =>
            r.status === 'approved' && ENGINEERING_ROLE_KINDS.includes(r.code),
        )
        .map((r) => r.code),
    );
    return {
      options,
      vocab: { approved },
      regionCountries,
      engineeringRoleKinds,
    };
  }

  async propose(p: { list: ListName; text: string }[]): Promise<void> {
    for (const { list, text } of p) {
      const code = slugCode(text);
      if (code === '') continue;
      const alias = text.trim().toLowerCase();
      const existing = this.row(list, code);
      if (!existing) {
        this.lists[list].push({
          code,
          label: text.trim(),
          aliases: alias === code ? [] : [alias],
          status: 'proposed',
          occurrences: 1,
        });
      } else if (existing.status === 'proposed') {
        existing.occurrences += 1;
        if (alias !== code && !existing.aliases.includes(alias))
          existing.aliases.push(alias);
      }
    }
  }

  async upsertCities(
    c: { name: string; countryCode: string }[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const city of c) {
      if (foldPlaceName(city.name) === '') continue;
      const forms = cityForms(
        this.cities.map((x, i) => ({
          ...x,
          aliases: x.aliases ?? [],
          firstSeenAt: x.firstSeenAt ?? new Date(i),
        })),
      );
      const foundId = forms.get(placeCityKey(city.countryCode, city.name));
      let found = this.cities.find((x) => x.id === foundId);
      if (found) found.occurrences += 1;
      else {
        found = {
          id: randomUUID(),
          name: city.name,
          countryCode: city.countryCode,
          status: 'proposed',
          occurrences: 1,
        };
        this.cities.push(found);
      }
      ids.set(`${city.name}|${city.countryCode}`, found.id);
    }
    return ids;
  }

  async bumpOccurrences(list: ListName, codes: string[]): Promise<void> {
    for (const code of codes) {
      const row = this.row(list, code);
      if (row) row.occurrences += 1;
    }
  }

  async listProposed(list: ListName): Promise<ProposedTerm[]> {
    return this.lists[list]
      .filter((r) => r.status === 'proposed')
      .map(({ code, label, aliases, occurrences }) => ({
        code,
        label,
        aliases: [...aliases],
        occurrences,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  async approve(list: ListName, code: string): Promise<boolean> {
    const row = this.row(list, code);
    if (row?.status !== 'proposed') return false;
    row.status = 'approved';
    return true;
  }

  async alias(list: ListName, code: string, to: string): Promise<void> {
    const source = this.row(list, code);
    if (source?.status !== 'proposed')
      throw new Error(`${list}: ${code} is not a proposed term`);
    const target = this.row(list, to);
    if (target?.status !== 'approved')
      throw new Error(`${list}: ${to} is not an approved term`);
    const form = source.label.trim().toLowerCase();
    if (form !== to && !target.aliases.includes(form))
      target.aliases.push(form);
    this.lists[list].splice(this.lists[list].indexOf(source), 1);
  }

  async reject(list: ListName, code: string): Promise<boolean> {
    const row = this.row(list, code);
    if (row?.status !== 'proposed') return false;
    this.lists[list].splice(this.lists[list].indexOf(row), 1);
    return true;
  }

  async listProposedCities(): Promise<ProposedCity[]> {
    return this.cities
      .filter((c) => c.status === 'proposed')
      .map(({ id, name, countryCode, occurrences }) => ({
        id,
        name,
        countryCode,
        occurrences,
      }));
  }

  async approveCity(id: string): Promise<boolean> {
    const city = this.cities.find((c) => c.id === id);
    if (city?.status !== 'proposed') return false;
    city.status = 'approved';
    return true;
  }

  async rejectCity(id: string): Promise<boolean> {
    const i = this.cities.findIndex(
      (c) => c.id === id && c.status === 'proposed',
    );
    if (i < 0 || this.citiesInUse.has(id)) return false;
    this.cities.splice(i, 1);
    return true;
  }

  async aliasCity(id: string, spelling: string): Promise<boolean> {
    const city = this.cities.find((c) => c.id === id);
    if (city?.status !== 'approved') return false;
    const aliases = (city.aliases ??= []);
    if (addsAlias(city.name, aliases, spelling)) aliases.push(spelling.trim());
    return true;
  }
}
