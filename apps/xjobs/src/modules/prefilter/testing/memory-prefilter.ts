/**
 * An in-memory stand-in for the prefilter's repository, following its
 * abstract contract closely enough for unit tests.
 */
import type { PlaceIndex } from 'src/modules/matcher/rules/places';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import {
  PrefilterRepository,
  type UncheckedJob,
} from '../repositories/prefilter.repository';
import {
  onSiteDemand,
  type OnSiteDemand,
  type PrefilterJob,
  type SkipReason,
} from '../rules/check';

export interface MemoryPrefilterJob extends PrefilterJob {
  id: string;
  kind: 'job' | 'post' | 'post_role';
  status: 'active' | 'merged';
  /** Has a LinkedIn job board source. */
  linkedIn: boolean;
  closed: boolean;
  expiresAt: Date | null;
  firstSeenAt: Date;
  processingStatus:
    | 'pending'
    | 'processing'
    | 'processed'
    | 'failed'
    | 'archived'
    | 'skipped'
    | null;
  processingReason: 'new' | 'reopened' | 'joined' | null;
  processingRequestedAt: Date | null;
  processingSkip: SkipReason | null;
  currentExtractionId: string | null;
}

export class MemoryPrefilterRepository extends PrefilterRepository {
  readonly jobs = new Map<string, MemoryPrefilterJob>();
  /** Published profiles' places. */
  readonly profiles: { locations: PlacesByArrangement }[] = [];
  places: PlaceIndex = {
    countriesOfRegion: new Map([['EU', new Set(['FR', 'DE'])]]),
    countryOfCity: new Map(),
    countries: new Set(['FR', 'DE', 'MA', 'US']),
  };
  /** Thrown by `loadDemand` when set. */
  demandError: Error | null = null;
  demandLoads = 0;
  /** Runs inside `markSkipped`, before its check: a concurrent write. */
  beforeMark: ((jobId: string) => void) | null = null;
  private seq = 0;

  constructor(private readonly now: () => Date = () => new Date()) {
    super();
  }

  /** Adds an in-scope, never processed `pending` listing; `p` overrides any field. */
  addJob(p: Partial<MemoryPrefilterJob> & { id: string }): MemoryPrefilterJob {
    const job: MemoryPrefilterJob = {
      kind: 'job',
      status: 'active',
      linkedIn: true,
      closed: false,
      expiresAt: null,
      firstSeenAt: this.now(),
      workplaceType: 'onsite',
      countryCode: 'FR',
      remoteAllowed: false,
      title: 'Backend Engineer',
      location: 'Paris',
      descriptionText: 'Come to the office.',
      processingStatus: 'pending',
      processingReason: 'new',
      // Distinct and increasing, so the claim order is the insertion order.
      processingRequestedAt: new Date(this.now().getTime() + this.seq++),
      processingSkip: null,
      currentExtractionId: null,
      ...p,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  job(id: string): MemoryPrefilterJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }

  /** Mirrors the SQL test of `listUncheckedPending`. */
  private unchecked(j: MemoryPrefilterJob): boolean {
    return (
      j.processingStatus === 'pending' &&
      j.currentExtractionId === null &&
      j.processingReason !== 'joined' &&
      j.status === 'active' &&
      j.kind === 'job' &&
      j.linkedIn
    );
  }

  private static view(j: MemoryPrefilterJob): UncheckedJob {
    return {
      id: j.id,
      workplaceType: j.workplaceType,
      countryCode: j.countryCode,
      remoteAllowed: j.remoteAllowed,
      title: j.title,
      location: j.location,
      descriptionText: j.descriptionText,
    };
  }

  async listUncheckedPending(limit: number): Promise<UncheckedJob[]> {
    return [...this.jobs.values()]
      .filter((j) => this.unchecked(j))
      .sort(
        (a, b) =>
          (a.processingRequestedAt?.getTime() ?? -Infinity) -
            (b.processingRequestedAt?.getTime() ?? -Infinity) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, limit)
      .map(MemoryPrefilterRepository.view);
  }

  async findUncheckedPending(jobId: string): Promise<UncheckedJob | null> {
    const job = this.jobs.get(jobId);
    return job && this.unchecked(job)
      ? MemoryPrefilterRepository.view(job)
      : null;
  }

  async loadDemand(): Promise<OnSiteDemand> {
    this.demandLoads++;
    if (this.demandError) throw this.demandError;
    return onSiteDemand(this.profiles, this.places);
  }

  async markSkipped(jobId: string, reason: SkipReason): Promise<boolean> {
    this.beforeMark?.(jobId);
    const job = this.jobs.get(jobId);
    if (
      !job ||
      !this.unchecked(job) ||
      job.workplaceType !== reason.tag ||
      job.countryCode?.toUpperCase() !== reason.country
    )
      return false;
    job.processingStatus = 'skipped';
    job.processingSkip = reason;
    job.processingRequestedAt = null;
    return true;
  }

  async reopenSkipped(filter: { firstSeenSince: Date }): Promise<number> {
    let n = 0;
    for (const job of this.jobs.values()) {
      if (
        job.processingStatus !== 'skipped' ||
        job.status !== 'active' ||
        job.firstSeenAt < filter.firstSeenSince ||
        job.closed ||
        (job.expiresAt !== null && job.expiresAt <= this.now())
      )
        continue;
      job.processingStatus = 'pending';
      job.processingReason = 'reopened';
      job.processingRequestedAt = this.now();
      n++;
    }
    return n;
  }
}
