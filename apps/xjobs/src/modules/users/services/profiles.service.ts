import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Arrangement,
  Position,
  ProfileState,
  Region,
  Seniority,
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
    skills: profile.techStack.map(({ technology, importance, mastery }) => ({
      technology: technology as Technology,
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

  /** Replaces the editable fields and the whole tech stack; the position and state are kept. */
  async replace(
    userId: string,
    profileId: string,
    data: ProfileReplaceWrite,
  ): Promise<ProfileView> {
    await this.users.getOrThrow(userId);
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
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return toProfileView(profile);
  }

  /** Deletes the row only; the caller removes its resume file. */
  async delete(userId: string, profileId: string): Promise<void> {
    await this.users.getOrThrow(userId);
    if (!(await this.profiles.delete(userId, profileId)))
      throw new NotFoundException(PROFILE_NOT_FOUND);
  }

  /** Generates the query search builders first, so a failure leaves the profile a draft. */
  async publish(
    userId: string,
    profileId: string,
  ): Promise<PublishedProfileView> {
    const profile = await this.getOrThrow(userId, profileId);
    const querySearches = await this.querySearch.generate(
      userId,
      profile.id,
      toQuerySearchInput(profile),
    );
    const published = await this.setState(
      userId,
      profile.id,
      ProfileState.published,
      new Date(),
    );
    return { ...toProfileView(published), querySearches };
  }

  /** Query search builders are kept; they are permanent. */
  async unpublish(userId: string, profileId: string): Promise<ProfileView> {
    const profile = await this.getOrThrow(userId, profileId);
    return toProfileView(
      await this.setState(userId, profile.id, ProfileState.draft, null),
    );
  }

  private async setState(
    userId: string,
    profileId: string,
    state: ProfileState,
    publishedAt: Date | null,
  ): Promise<ProfileWithSkills> {
    const profile = await this.profiles.setState(
      userId,
      profileId,
      state,
      publishedAt,
    );
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }
}
