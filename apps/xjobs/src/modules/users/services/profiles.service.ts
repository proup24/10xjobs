import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Arrangement,
  Position,
  ProfileState,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import {
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/queries';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersService } from './users.service';
import type {
  ProfileFields,
  ProfileInput,
  ProfileView,
  ProfileWithSkills,
  PublishedProfileView,
  SkillInput,
} from '../types';

/** The API shape of a profile: no storage key, stack ordered by importance, then what the user wants most. */
export function toProfileView(profile: ProfileWithSkills): ProfileView {
  const {
    techStack,
    resumeKey,
    resumeFilename,
    resumeSizeBytes,
    resumeSha256,
    resumeUploadedAt,
    ...fields
  } = profile;
  return {
    ...fields,
    techStack: techStack
      .map(({ technology, domain, mastery, importance }) => ({
        technology,
        domain,
        mastery,
        importance,
      }))
      .sort((a, b) => b.importance - a.importance || b.mastery - a.mastery),
    resume:
      resumeKey && resumeFilename && resumeSha256 && resumeUploadedAt
        ? {
            filename: resumeFilename,
            sizeBytes: resumeSizeBytes ?? 0,
            sha256: resumeSha256,
            uploadedAt: resumeUploadedAt,
          }
        : null,
  };
}

/** What query search builders are generated from; importance 0 skills stay in so the builders can drop them. */
export function toQuerySearchInput(
  profile: ProfileWithSkills,
): QuerySearchProfileInput {
  // Rows carry plain string unions; the enums have the same values.
  return {
    position: profile.position as Position,
    regions: [...profile.regions] as Region[],
    arrangements: [...profile.arrangements] as Arrangement[],
    seniority: profile.seniority as Seniority,
    country: profile.country,
    city: profile.city,
    skills: profile.techStack.map(({ technology, domain, importance, mastery }) => ({
      technology: technology as Technology,
      domain: domain as SkillDomain,
      importance,
      mastery,
    })),
  };
}

/** A profile write as the API sends it: importance may be left out and defaults to 5. */
export type ProfileWrite = Omit<ProfileInput, 'city'> & {
  city?: string | null;
  techStack: (Omit<SkillInput, 'importance'> & { importance?: number })[];
};

/** A replacement as the API sends it: the position is fixed at creation and cannot be sent. */
export type ProfileReplaceWrite = Omit<ProfileWrite, 'position'>;

function toSkills(techStack: ProfileReplaceWrite['techStack']): SkillInput[] {
  return techStack.map(({ technology, domain, mastery, importance }) => ({
    technology,
    domain,
    mastery,
    importance: importance ?? 5,
  }));
}

const PROFILE_NOT_FOUND = 'Profile not found';
export const PROFILE_PUBLISHED =
  'A published profile cannot be changed; delete it and create a new one';

/** A user owns many profiles; every operation takes `(userId, profileId)` and checks ownership. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
  ) {}

  /** 404s an unknown user, or a profile that is not this user's. */
  async getOrThrow(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills> {
    await this.users.getOrThrow(userId);
    const profile = await this.profiles.findById(userId, profileId);
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }

  async list(userId: string): Promise<ProfileView[]> {
    await this.users.getOrThrow(userId);
    return (await this.profiles.list(userId)).map(toProfileView);
  }

  /** 404s like getOrThrow, and 409s a published profile: only drafts can change. */
  async getDraftOrThrow(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills> {
    const profile = await this.getOrThrow(userId, profileId);
    if (profile.state !== ProfileState.draft)
      throw new ConflictException(PROFILE_PUBLISHED);
    return profile;
  }

  /** After a guarded write matched nothing: 404 if the profile is gone, otherwise it was published. */
  private async rejectWrite(userId: string, profileId: string): Promise<never> {
    await this.getDraftOrThrow(userId, profileId);
    // Still a draft yet the write missed: treat it as a lost race on publish.
    throw new ConflictException(PROFILE_PUBLISHED);
  }

  async get(userId: string, profileId: string): Promise<ProfileView> {
    return toProfileView(await this.getOrThrow(userId, profileId));
  }

  /** New profiles start as unpublished drafts. */
  async create(userId: string, data: ProfileWrite): Promise<ProfileView> {
    await this.users.getOrThrow(userId);
    const { techStack, ...fields } = data;
    return toProfileView(
      await this.profiles.create(
        userId,
        { ...fields, city: fields.city ?? null },
        toSkills(techStack),
      ),
    );
  }

  /** Replaces a draft's editable fields and whole tech stack; the position is kept. Published profiles are frozen. */
  async replace(
    userId: string,
    profileId: string,
    data: ProfileReplaceWrite,
  ): Promise<ProfileView> {
    await this.getDraftOrThrow(userId, profileId);
    // Built field by field so a stray `position` can never reach the update.
    const fields: ProfileFields = {
      languages: data.languages,
      country: data.country,
      city: data.city ?? null,
      regions: data.regions,
      yearsOfExperience: data.yearsOfExperience,
      timezoneCurrent: data.timezoneCurrent,
      timezoneMin: data.timezoneMin,
      timezoneMax: data.timezoneMax,
      engagements: data.engagements,
      arrangements: data.arrangements,
      seniority: data.seniority,
      noticePeriodDays: data.noticePeriodDays,
    };
    const profile = await this.profiles.replace(
      userId,
      profileId,
      fields,
      toSkills(data.techStack),
    );
    if (!profile) return this.rejectWrite(userId, profileId);
    return toProfileView(profile);
  }

  /**
   * The only way out of a profile, published or not: releases its shared query
   * search builders (each loses one associated profile and goes inactive at 0),
   * then deletes the row. The caller removes its resume file.
   */
  async delete(userId: string, profileId: string): Promise<void> {
    const profile = await this.getOrThrow(userId, profileId);
    await this.querySearch.detach(profile.id);
    if (!(await this.profiles.delete(userId, profile.id)))
      throw new NotFoundException(PROFILE_NOT_FOUND);
  }

  /**
   * Releases the builders of every profile a user owns, so the shared counters
   * stay right when the user's rows cascade away.
   */
  async releaseAll(userId: string): Promise<void> {
    for (const profile of await this.profiles.list(userId)) {
      await this.querySearch.detach(profile.id);
    }
  }

  /**
   * Publishes a draft for good. Its shared query search builders are attached
   * first, so a failure leaves it a draft; after this it can only be deleted.
   */
  async publish(
    userId: string,
    profileId: string,
  ): Promise<PublishedProfileView> {
    const profile = await this.getDraftOrThrow(userId, profileId);
    const querySearches = await this.querySearch.generate(
      profile.id,
      toQuerySearchInput(profile),
    );
    const published = await this.profiles.publish(
      userId,
      profile.id,
      new Date(),
    );
    if (!published) {
      // Deleted meanwhile: release what was just attached so counts stay right.
      // Published meanwhile: the winner attached the same builders; keep them.
      if (!(await this.profiles.findById(userId, profile.id)))
        await this.querySearch.detach(profile.id);
      return this.rejectWrite(userId, profile.id);
    }
    return { ...toProfileView(published), querySearches };
  }
}
